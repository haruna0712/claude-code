# Daphne / Channels 運用 Runbook (P3-13)

> **対応 Issue**: #238
> **対象モジュール**: `terraform/modules/services/` (daphne ECS), `terraform/modules/compute/` (ALB target group)
> **関連 SPEC**: [docs/SPEC.md](../SPEC.md) §7 (DM リアルタイム), [docs/ARCHITECTURE.md](../ARCHITECTURE.md) §3.3 / §3.4 / §3.5

Phase 3 で追加した Daphne (ASGI WebSocket server) の運用手順をまとめる。

---

## 1. 全体像

```
                  CloudFront / ALB
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   /api/* /admin/*    /*ws/*           その他 (Next.js)
        │               │               │
   target=app       target=daphne   target=next
   (Django,8000)    (Daphne,8001)   (Next.js,3000)
                    sticky 24h
                    idle 3600s
```

- WebSocket は再接続時に **同じ Daphne タスク** に戻すため target group は ALB cookie で sticky (24h)
- ALB の `idle_timeout = 3600s` は config/asgi.py 側の Channels 設定と整合
- Daphne 単体は CPU 256 / Memory 512MB (stg)、Auto Scaling は CPU 80% で min=1, max=2

---

## 2. apply 手順

```bash
# Step 0: 操作対象アカウントを確認 (stg / prod 取り違え防止)
aws sts get-caller-identity

cd terraform/environments/stg
terraform fmt
terraform validate
terraform plan -out=daphne.plan
# → 差分確認後、ハルナさん手動で:
terraform apply daphne.plan
```

> CLAUDE.md §9 の通り、`terraform apply` は人間が必ず実行する。Claude は plan までで止まる。

---

## 3. 動作確認手順

### 3.1 ECS task の起動確認

```bash
aws ecs describe-services \
  --cluster sns-stg-cluster \
  --services sns-stg-daphne \
  --query 'services[0].{Desired:desiredCount,Running:runningCount,Status:status}'
# 期待: Desired=1, Running=1, Status="ACTIVE"

aws ecs describe-tasks \
  --cluster sns-stg-cluster \
  --tasks $(aws ecs list-tasks --cluster sns-stg-cluster --service-name sns-stg-daphne --query 'taskArns[]' --output text) \
  --query 'tasks[0].{LastStatus:lastStatus,HealthStatus:healthStatus,StartedAt:startedAt}'
# 期待: LastStatus="RUNNING", HealthStatus="HEALTHY"
```

### 3.2 ALB target group の Healthy count

```bash
TG_ARN=$(aws elbv2 describe-target-groups --names sns-stg-daphne --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,State:TargetHealth.State}'
# 期待: 全 target が State=healthy
```

### 3.3 WebSocket 接続テスト

```bash
# wscat (npm install -g wscat) で /ws/health/ に 101 (switching protocols) を期待
wscat -c "wss://stg.example.com/ws/health/"
# 期待: Connected (press CTRL+C to quit)

# 認証必須の DM room へは Cookie JWT 付きで:
COOKIE="access=...; refresh=..."
wscat -c "wss://stg.example.com/ws/dm/<room_id>/" -H "Cookie: $COOKIE"
# 期待: Connected (4401 / 4403 で close されない)
```

### 3.4 Sticky session cookie の確認

```bash
curl -is "https://stg.example.com/ws/health/" | grep -i "set-cookie"
# 期待: AWSALB= ... のクッキーが返る (target stickiness 24h)
```

### 3.5 Cutover (deployment) 中の WebSocket 挙動

cutover 中は新旧両方の Daphne タスクが Healthy になり、deregistration_delay (300s) 中は
旧タスクへの既存 WebSocket 接続を維持しつつ新規接続は新タスクへ振り分ける想定:

```bash
# 新 task definition revision を deploy
aws ecs update-service --cluster sns-stg-cluster --service sns-stg-daphne --force-new-deployment

# 1 分後の状態確認
sleep 60
aws ecs describe-services --cluster sns-stg-cluster --services sns-stg-daphne \
  --query 'services[0].deployments[].{Status:status,Desired:desiredCount,Running:runningCount,Created:createdAt}'
# 期待: PRIMARY と ACTIVE が両方表示される (blue/green 風)、既存接続は ACTIVE 側で維持
```

---

## 4. Auto Scaling の挙動

| 条件                                         | 動作                      |
| -------------------------------------------- | ------------------------- |
| Daphne CPU avg > 80% (3 datapoints in 1 min) | task を 1 増やす (上限 2) |
| Daphne CPU avg < 80% × 5 min                 | task を 1 減らす (下限 1) |

Auto Scaling は `aws_appautoscaling_*` で AWS Application Auto Scaling 経由。
CloudWatch アラーム / SNS 通知は Phase P3-18 (#243) で別途実装する。

> WebSocket connection 数を直接 metric にできないため CPU を proxy として使っている。
> Phase 4 で CW custom metric (active connections) に切り替え予定。

---

## 5. トラブルシュート

### 5.1 `wscat` で 503

target group が Healthy 0 の可能性。`describe-target-health` で確認。task の起動失敗なら CloudWatch Logs `/ecs/sns-stg/daphne` を確認。

### 5.2 4401 Unauthorized で即 close

Cookie JWT が無効。Django 側の auth middleware で reject されている。fast の場合は config/asgi.py の `JWTAuthMiddleware` 関連ログを確認。

### 5.3 4403 Forbidden で即 close

room メンバーでない。クライアントの room_id 解決ミス。

### 5.4 接続中に突然 1006 abnormal close

ALB idle_timeout 超過の可能性。Channels 側で keepalive ping (60s 間隔程度) を Phase 4 で導入予定。

### 5.5 cutover 中に既存接続が drop

`deregistration_delay` を増やす (現状 300s)。または `deployment_minimum_healthy_percent = 100` を確認。

---

## 6. 関連ドキュメント

- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) §3.3 ALB / §3.4 ECS Daphne / §3.5 Auto Scaling
- [docs/operations/phase-3-stub-bridges.md](./phase-3-stub-bridges.md) — Phase 4 移行用ブリッジスタブ
- [docs/SPEC.md](../SPEC.md) §7 — DM リアルタイム要件
