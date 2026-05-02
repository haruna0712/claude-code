# DM インシデント対応 Runbook (P3-18)

> **対応 Issue**: #243
> **対象モジュール**: `terraform/modules/observability/` (CloudWatch alarms / dashboard)
> **関連 SPEC**: [docs/SPEC.md](../SPEC.md) §7 (DM), [docs/ARCHITECTURE.md](../ARCHITECTURE.md) §観測性

Phase 3 の DM 機能で発火しうる CloudWatch アラームと、調査・復旧手順を定める。

---

## 1. 監視対象とアラーム閾値

| アラーム名                            | メトリクス                                  | 閾値   | 評価期間 | 通知先 SNS Topic |
| ------------------------------------- | ------------------------------------------- | ------ | -------- | ---------------- |
| `sns-stg-daphne-5xx-rate-high`        | /ws/\* (daphne TG) 5xx error rate           | > 1%   | 5min × 2 | `sns-stg-alerts` |
| `sns-stg-redis-curr-connections-high` | ElastiCache Redis CurrConnections (Channel) | > 1000 | 5min × 2 | `sns-stg-alerts` |
| `sns-stg-redis-engine-cpu-high`       | ElastiCache Redis EngineCPUUtilization      | > 80%  | 5min × 2 | `sns-stg-alerts` |
| `sns-stg-ecs-daphne-cpu-high`         | Daphne ECS service CPUUtilization           | > 80%  | 5min × 3 | `sns-stg-alerts` |
| `sns-stg-alb-5xx-rate-high` (既存)    | ALB 全体の 5xx error rate                   | > 1%   | 5min × 2 | `sns-stg-alerts` |

ダッシュボード: AWS Console → CloudWatch → Dashboards → `sns-stg-dm`

---

## 2. アラート受信時の初動

### 2.1 共通フロー

1. SNS topic `sns-stg-alerts` 経由のメールを受信したら **CloudWatch Dashboard を開く** (`sns-stg-dm`)
2. アラーム種別を判別 (下記 §3〜§5 へ)
3. オーナー (ハルナさん) に **5 分以内** に Slack で連絡 (Phase 4 で paging に切り替え予定)
4. 復旧後、`docs/operations/dm-incident-runbook.md` に **インシデント抜粋** を追記

### 2.2 アカウント / 環境の取り違え防止

```bash
aws sts get-caller-identity   # stg と prod のアカウント ID を必ず確認
```

---

## 3. `/ws/* 5xx > 1%` 急増時の調査

### 3.1 daphne ECS task のログを直近 5 分で確認

> **PII 注意 (architect MEDIUM M-4)**: structlog 設定で `message_body` / `body` 等の DM 本文
> フィールドがログに混入していないか先に grep で確認すること。混入時は CloudWatch Logs
> Insights で `fields @timestamp, @message | filter @message not like /body=/` のように
> 除外クエリを使う。Phase 9 で `drop_key` による恒久対応予定。

```bash
aws logs tail /ecs/sns-stg/daphne --since 5m --follow
```

確認ポイント:

- `WebSocketDisconnect` の連発 → クライアント側のネットワーク問題か、Channels middleware で reject されている
- `Could not connect to Redis` → ElastiCache 障害 / セキュリティグループ変更
- `ImproperlyConfigured: DJANGO_CHANNELS_ALLOWED_ORIGINS` → 環境変数欠落 (P3-13 で注入済、TF 反映漏れの可能性)

### 3.2 ALB target group の Healthy count

```bash
TG_ARN=$(aws elbv2 describe-target-groups --names sns-stg-daphne-tg \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 describe-target-health --target-group-arn "$TG_ARN" \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,State:TargetHealth.State,Reason:TargetHealth.Reason}'
```

- Healthy 0 → ECS task の起動失敗。`aws ecs describe-services --cluster sns-stg-cluster --services sns-stg-daphne` で `events` を確認
- HealthCheck 失敗が継続 → asgi.py の `/api/health/` ルーティング、または DB / Redis 起動順序

### 3.3 ECS deployment 進行中？

```bash
aws ecs describe-services --cluster sns-stg-cluster --services sns-stg-daphne \
  --query 'services[0].deployments[].{Status:status,Desired:desiredCount,Running:runningCount}'
```

deployment 中の cutover で旧 task に駆け込み接続が来ると 5xx が一時的にスパイクする。これは正常動作 (deregistration_delay=300s 内に収まれば 5min 平均で 1% を超えないはず)。

### 3.4 復旧アクション候補

| 原因                                        | アクション                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| 新 task が unhealthy で循環 deployment      | `aws ecs update-service --force-new-deployment` 取消 (前の image に戻す) |
| Redis 障害                                  | §4 の手順                                                                |
| アプリ regression (新 release で 5xx 連発)  | revert PR + `cd-stg.yml` 再 deploy                                       |
| ALB idle_timeout 超過 (1006 abnormal close) | クライアント側の keepalive ping 確認 (Phase 4 で導入予定)                |

---

## 4. `Channel layer Redis CurrConnections > 1000` の調査

### 4.1 Redis 接続元を特定

```bash
# CloudWatch Dashboard の Daphne CPU と相関を見る
# CurrConnections が daphne task 数 (1〜2) と桁違いに大きい場合は connection leak
```

Daphne 1 task あたり typical 10〜30 connection (channel layer pubsub + cache)。1000 を超えるのは:

- Daphne の Channel groups が解放されない (consumers の disconnect 漏れ)
- 別ワークロード (Celery / Django web) も同 Redis を使っており leak

### 4.2 Daphne を再起動 (接続を強制リセット)

```bash
aws ecs update-service --cluster sns-stg-cluster --service sns-stg-daphne --force-new-deployment
```

### 4.3 Redis 側の確認

```bash
aws elasticache describe-replication-groups --replication-group-id sns-stg-redis \
  --query 'ReplicationGroups[0].{Status:Status,NumNodes:MemberClusters}'

# 必要なら手動 FLUSHALL (テスト用、本番では絶対しない):
# redis-cli -h <primary> --tls -a <auth> FLUSHALL
```

### 4.4 復旧後の事後確認

ダッシュボード `sns-stg-dm` で CurrConnections が下限値 (typical 10〜30) に戻ること。

---

## 5. `Daphne ECS CPU > 80%` 継続時

### 5.1 Auto Scaling は機能しているか

stg は min=1 / max=2。現在の running count 確認:

```bash
aws ecs describe-services --cluster sns-stg-cluster --services sns-stg-daphne \
  --query 'services[0].{Desired:desiredCount,Running:runningCount}'
```

すでに max=2 に達している場合は、メッセージ trafficが想定外に多い。Phase 4 で max を 4 へ引き上げ検討。

### 5.2 daphne タスクの cpu/mem を一時的に増やす

```bash
# terraform.tfvars で daphne_cpu = 512 / daphne_memory = 1024 に上げて plan / apply
```

---

## 6. Sticky session 切れの再現手順 (テスト用)

```bash
# 1. Daphne task を 2 つに増やす (force-new-deployment + min_healthy=100% で blue/green)
aws ecs update-service --cluster sns-stg-cluster --service sns-stg-daphne \
  --desired-count 2

# 2. wscat で接続 (cookie が AWSALB= で発行されるはず)
wscat -c "wss://stg.example.com/ws/dm/<room_id>/" -H "Cookie: <auth>"

# 3. その session を維持したまま Cookie を消去して別セッション (curl) を発行 → 別 task に振り分けられる
# /api/health/ は ALB target group の health check と同じ HTTP route (asgi.py 設計)
curl -i "https://stg.example.com/api/health/" --no-cookie
```

期待: 1 つ目の WS 接続は同 task に張り付き、2 つ目は AWS ALB cookie の値で振り分けが切り替わる。

---

## 7. アラーム test 発火手順

### 7.1 5xx alarm の test

```bash
# /ws/health/ に対して大量の HTTP GET を投げて 4xx/5xx を作る (5xx 専用テスト endpoint は未実装、代替手段)
ab -n 1000 -c 10 https://stg.example.com/ws/this-path-does-not-exist/
# CloudWatch で 5xx > 1% が観測 → 5min 後にアラーム発火
```

### 7.2 SNS 通知の test

```bash
TOPIC_ARN=$(aws sns list-topics --query 'Topics[?contains(TopicArn, `sns-stg-alerts`)].TopicArn' --output text)
aws sns publish --topic-arn "$TOPIC_ARN" --subject "TEST P3-18" --message "test from runbook"
```

メールが alert_email 宛に届くこと。

---

## 8. 既知の制限・将来の改善

| 項目                                             | 状態           | 改善 Phase                                |
| ------------------------------------------------ | -------------- | ----------------------------------------- |
| カスタムメトリクス `dm.message.send_latency_p95` | 未実装         | Phase 4 (Django から put_metric_data)     |
| WebSocket active connections の直接 metric       | 未実装         | Phase 4 (Daphne stats endpoint or custom) |
| Auto Scaling の WebSocket 接続数ベース           | 未実装         | Phase 4 (custom metric が前提)            |
| paging (PagerDuty / OpsGenie)                    | SNS email のみ | Phase 6+                                  |

---

## 9. 関連ドキュメント

- [docs/operations/dm-channels-runbook.md](./dm-channels-runbook.md) — Daphne / Channels 運用 (P3-13)
- [docs/operations/infrastructure.md](./infrastructure.md) — インフラ全体像
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) §観測性
