# 通知 E2E 実行コマンド

> シナリオ: [notifications-scenarios.md](./notifications-scenarios.md)
> Playwright spec: `client/e2e/notifications-scenarios.spec.ts`

## 環境変数

```bash
export PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
export PLAYWRIGHT_USER1_EMAIL=test1@gmail.com
export PLAYWRIGHT_USER1_PASSWORD=<test1_password>
export PLAYWRIGHT_USER1_HANDLE=test1
export PLAYWRIGHT_USER2_EMAIL=test2@gmail.com
export PLAYWRIGHT_USER2_PASSWORD=<test2_password>
export PLAYWRIGHT_USER2_HANDLE=test2
```

## ローカルから stg を叩く

```bash
cd client
npx playwright test e2e/notifications-scenarios.spec.ts --workers=1
```

## golden path のみ実行

```bash
npx playwright test e2e/notifications-scenarios.spec.ts \
  --workers=1 \
  --grep "NOT-01"
```

## デバッグモード (UI 表示 + step 実行)

```bash
npx playwright test e2e/notifications-scenarios.spec.ts --debug
```

## CI で実行する場合 (将来)

GitHub Actions の workflow に Playwright job を追加する場合、stg 用 secret を OIDC 経由で渡す。本 Issue 範囲では手動実行のみ。

## 直接 API で確認する手順 (Playwright が使えない時)

```bash
# 1. USER2 として login → USER1 の tweet を like
curl -X POST -c /tmp/u2_cookies.txt -b /tmp/u2_cookies.txt \
  -H "Content-Type: application/json" \
  -H "X-CSRFToken: <csrf>" \
  -H "Referer: https://stg.codeplace.me/" \
  -d '{"kind":"like"}' \
  https://stg.codeplace.me/api/v1/tweets/<TWEET_ID>/reactions/

# 2. USER1 で notifications を確認
curl -b /tmp/u1_cookies.txt https://stg.codeplace.me/api/v1/notifications/?unread_only=true

# 3. unread-count
curl -b /tmp/u1_cookies.txt https://stg.codeplace.me/api/v1/notifications/unread-count/
```
