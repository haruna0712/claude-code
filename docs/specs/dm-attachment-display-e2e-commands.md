# DM 添付表示 E2E 実行コマンド

> 関連: [dm-attachment-display-spec.md](./dm-attachment-display-spec.md), [dm-attachment-display-scenarios.md](./dm-attachment-display-scenarios.md)
>
> Playwright spec: `client/e2e/dm-attachment-display.spec.ts`

## 環境変数

```bash
export PLAYWRIGHT_BASE_URL=https://stg.codeplace.me
export PLAYWRIGHT_USER1_EMAIL=test2@gmail.com
export PLAYWRIGHT_USER1_PASSWORD=<test2_password>
export PLAYWRIGHT_USER1_HANDLE=test2
export PLAYWRIGHT_USER2_EMAIL=test3@gmail.com
export PLAYWRIGHT_USER2_PASSWORD=<test3_password>
export PLAYWRIGHT_USER2_HANDLE=test3
export PLAYWRIGHT_ROOM_ID=1   # test2 ⇄ test3 の direct room
```

## fixtures

```bash
ls /workspace/client/e2e/fixtures/
# sample-image.png  (640x480 程度の小さい PNG、< 50KB)
# sample-doc.pdf    (1 page、< 50KB)
```

## 全シナリオ実行

```bash
cd /workspace/client
npx playwright test e2e/dm-attachment-display.spec.ts --workers=1
```

`--workers=1` は spec 内で 2 ユーザの逐次操作 (送信 → 受信確認) を行うため必須。

## 個別実行

```bash
# 表示系 (A-01..A-05)
npx playwright test e2e/dm-attachment-display.spec.ts --grep "A-0"

# Lightbox 系 (L-01..L-07)
npx playwright test e2e/dm-attachment-display.spec.ts --grep "L-0"

# ダウンロード (D-01)
npx playwright test e2e/dm-attachment-display.spec.ts --grep "D-01"

# a11y (Y-01..Y-02)
npx playwright test e2e/dm-attachment-display.spec.ts --grep "Y-0"
```

## デバッグ (UI mode + step 実行)

```bash
npx playwright test e2e/dm-attachment-display.spec.ts --debug
# or
npx playwright test e2e/dm-attachment-display.spec.ts --ui
```

## API 単体での検証 (Playwright を使わずに)

```bash
BASE=https://stg.codeplace.me
# 1. test2 login
rm -f /tmp/c2.txt
curl -sS -c /tmp/c2.txt $BASE/api/v1/auth/csrf/ -o /dev/null
CSRF=$(grep csrftoken /tmp/c2.txt | awk '{print $7}')
curl -sS -c /tmp/c2.txt -b /tmp/c2.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" -H "Referer: $BASE/login" \
  -d "{\"email\":\"test2@gmail.com\",\"password\":\"$PLAYWRIGHT_USER1_PASSWORD\"}" \
  $BASE/api/v1/auth/cookie/create/

# 2. message GET でレスポンスに url field が出るか
curl -sS -b /tmp/c2.txt $BASE/api/v1/dm/rooms/1/messages/ \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for m in d['results']:
    for a in m.get('attachments', []):
        print(f\"attachment {a['id']}: url={a.get('url','MISSING')}, w={a.get('width')}, h={a.get('height')}\")
" | head -10

# 3. confirm payload に width/height を含めて新規 confirm
curl -sS -b /tmp/c2.txt -X POST \
  -H "Content-Type: application/json" -H "X-CSRFToken: $CSRF" -H "Referer: $BASE/" \
  -d '{"room_id":1,"s3_key":"dm/1/.../foo.png","filename":"foo.png","mime_type":"image/png","size":12345,"width":640,"height":480}' \
  $BASE/api/v1/dm/attachments/confirm/
```

## stg 動作確認 (手動 UI)

PR マージ + cd-stg deploy 完了後:

1. `https://stg.codeplace.me/login` で test2 でログイン
2. `https://stg.codeplace.me/messages/1` を開く
3. 📎 → 画像選択 → 送信
4. メッセージ bubble 内に画像 thumbnail が見える
5. thumbnail click → lightbox 開く、filename がヘッダー、ESC で閉じる
6. PDF を 📎 → 送信 → file chip が表示、ダウンロード button で OS dialog
7. 4 枚以上送信 → grid 配置、5 枚超なら「+N」overlay

## CI 実行 (将来)

GitHub Actions に Playwright job を追加する場合は stg secrets を OIDC で渡す。本 phase は手動実行のみ。
