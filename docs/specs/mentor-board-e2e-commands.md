# メンター募集 board E2E 実行コマンド

> 関連 spec: [mentor-board-spec.md](./mentor-board-spec.md) / [mentor-board-scenarios.md](./mentor-board-scenarios.md)
> Playwright spec ファイル: `client/e2e/mentor-board.spec.ts`

Phase 11 11-A の golden path を stg で実行するための **そのまま貼れる** コマンドメモ。 CLAUDE.md §4.5 step 6 「Playwright 実行コマンド」 のためのドキュメント。

## 前提

- stg URL: `https://stg.codeplace.me`
- test 用 user (mentee/mentor 切替): test2 (USER1) と test3 (USER2)、 credential は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照
- backend は P11-05 まで merge 済 (`/api/v1/mentor/...` 全 endpoint 利用可)
- frontend は P11-08 まで merge 済 (`/mentor/wanted` + `/mentor/wanted/<id>` + DM banner)

## 1. stg Playwright で 自動 E2E (第一選択)

```bash
cd /workspace/client

# env (test2 / test3 の credential) は docs/local/e2e-stg.md 参照
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=... PLAYWRIGHT_USER1_PASSWORD=... PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=... PLAYWRIGHT_USER2_PASSWORD=... PLAYWRIGHT_USER2_HANDLE=test3 \
  npx playwright test e2e/mentor-board.spec.ts
```

期待: MENTOR-1 / MENTOR-2 / MENTOR-3 が全 GREEN。

## 2. curl API smoke (debug 用)

```bash
# CSRF token を取得
CSRF=$(curl -s -c /tmp/cookies.txt "https://stg.codeplace.me/api/v1/auth/csrf/" -o /dev/null && grep csrftoken /tmp/cookies.txt | awk '{print $7}')

# test2 で login (credential は docs/local/e2e-stg.md 参照)
curl -s -b /tmp/cookies.txt -c /tmp/cookies.txt -X POST "https://stg.codeplace.me/api/v1/auth/cookie/create/" \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" -H "Referer: https://stg.codeplace.me/login" \
  -d '{"email":"...","password":"..."}' -w "\nstatus=%{http_code}\n"

# 募集投稿
curl -s -b /tmp/cookies.txt -X POST "https://stg.codeplace.me/api/v1/mentor/requests/" \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" -H "Referer: https://stg.codeplace.me/mentor/wanted/new" \
  -d '{"title":"smoke","body":"smoke body"}' -w "\nstatus=%{http_code}\n"

# 一覧 (anon でも OK)
curl -s "https://stg.codeplace.me/api/v1/mentor/requests/" | jq '.results | length'
```

## 3. Playwright MCP / Chrome 手動 (stg 反映待ちのとき or 補助)

- `https://stg.codeplace.me/mentor/wanted` を anon で開く → 「ログインして募集する」 CTA を screenshot
- `https://stg.codeplace.me/mentor/wanted/<id>` を test3 で開く → 提案 form を screenshot
- accept 後の `/messages/<room_id>` で banner「🤝 メンタリング契約中」 を screenshot

## トラブルシュート

| 症状                                          | 原因候補                                     | 対処                                                                  |
| --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| accept で 400「この募集は受付終了しています」 | 既に他 mentor で MATCHED 済                  | 新しい request を投稿し直す                                           |
| accept で 404                                 | request または proposal が削除済 / pk 間違い | `/api/v1/mentor/requests/<id>/proposals/` (owner 認証) で生存確認     |
| MENTOR-1 / step 8 で DM banner が見えない     | P11-08 frontend が deploy 済か               | `/_next/static/chunks/` 配下を grep して「メンタリング契約中」 を確認 |

## 関連

- Playwright spec: `client/e2e/mentor-board.spec.ts`
- backend tests: `apps/mentorship/tests/test_accept_proposal.py` (atomic + idempotent)
- gan-evaluator 採点候補: 11-A 完成後に「ホーム → 3 click 以内」 + 「未ログインで壊れない」 + 「契約成立シグナル」 を採点させる
