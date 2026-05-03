# Phase 3 フォローアップ Issues

Phase 3 (DM) の stg 動作確認 + Phase 3 E2E spec 完走の過程で発覚した
インフラ・型・UI wire-up 起因の不具合を追跡する。Phase 3 マイルストーン
クローズ前に解消する想定 (一部は Phase 9 本番昇格まで持ち越し可)。

## 一覧

| Issue | 件名                                                                      | 状態   | 優先度 | 着手 Phase           |
| ----- | ------------------------------------------------------------------------- | ------ | ------ | -------------------- |
| #269  | useUserProfile を `/api/v1/users/me/` に修正                              | closed | high   | Phase 3              |
| #275  | ALB から CloudFront 経由 WebSocket 経路の SSL 不整合                      | closed | high   | Phase 3              |
| #276  | InvitationList の type drift + room_name field 追加                       | closed | high   | Phase 3              |
| #281  | `COOKIE_DOMAIN` 設定 + spec WS-skip 解除                                  | closed | high   | Phase 3              |
| #285  | グループ招待拒否時に list が refresh されず 403 を返す (CSRF Cookie 不在) | closed | high   | Phase 3              |
| #273  | `/messages` に「+ 新規グループ」 button が wire-up されていない           | closed | medium | Phase 3              |
| #274  | DM メッセージの削除 UI (hover delete + 楽観 UI + WS broadcast 受信)       | closed | medium | Phase 3              |
| #277  | Phase 3 E2E spec を 8 シナリオに拡張 + API bootstrap helper 追加          | closed | medium | Phase 3              |
| #291  | sns-stg-django ECS task が container health check 失敗で慢性 flapping     | open   | high   | **Phase 3 (進行中)** |

## #291 の根本原因と対応方針

PR #29X (本ファイルを含む同 PR) で fix する。

### 根本原因 (architect 調査結果)

`terraform/modules/services/main.tf:177` の Django container `healthCheck` が
`curl -fsSL http://localhost:8000/api/health/` だが、base image
`python:3.12.2-slim-bookworm` に curl が同梱されていない。`apt-get install`
にも curl は含まれず、毎回 `curl: command not found` の exit 127 が ECS に
返される。

- ALB target group probe は別経路で /api/health/ を叩いているので 200 が
  CloudWatch logs に残る (見かけ上 healthy)
- container probe は startPeriod=60s 経過後に retries=3 × interval=30s = 90s
  で UNHEALTHY 確定 → ECS が task を kill
- 結果: deploy 完了直後の task が ~3 分で kill され、cd-stg の
  `aws ecs wait services-stable` が 10 分タイムアウトする

### 修正

1. **healthCheck command を python urllib に置換** (curl 依存除去)
2. **startPeriod=120s, retries=5 に緩和** (collectstatic + Aurora cold connect 余裕)
3. **start.sh から `python manage.py migrate` を削除** (cd-stg.yml の
   `sns-stg-django-migrate` task で実施しているので重複)
4. **gunicorn flags 改善**:
   - `--timeout 60` (default 30 → Aurora cold connect 許容)
   - `--graceful-timeout 30` (ECS stopTimeout と整合)
   - `--preload` (worker fork 前に app import → cold connect 1 回に集約)

### 副次検討 (本 PR 外、future work)

- `/api/health/` を `/health/live` (pure 200) と `/health/ready` (DB ping) に
  分離し、container probe は live、ALB probe は ready を叩く分業
- ALB `deployment_minimum_healthy_percent=100, maximum_percent=200` で
  blue/green 寄り cutover にして deploy 中の 503 窓を縮める
- gunicorn `--worker-class gthread --threads 4` への切替検討 (ALB + sticky
  session 環境下での同時接続数余裕、Phase 4 以降のトラフィック増で再検討)

## 受け入れ条件 (Phase 3 マイルストーン close 前)

- [ ] PR #29X (#291 fix) が merge され cd-stg deploy が成功
- [ ] /api/health/ が 30 分以上連続で 200
- [ ] cd-stg deploy の `services-stable` が 5 分以内に成功
- [ ] Phase 3 spec を 3 回連続実行して 8/8 が安定して green
