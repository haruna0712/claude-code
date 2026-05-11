# /tag/[name] A direction polish (#581 Phase B-1-8)

## 背景

#579 (B-1-7) で /tweet/[id], /threads/[id] を polish 済。次は /tag/[name]。outer `<main>` (nested) + sticky header 無し。

## 期待動作

- 外側 `<main>` を `<div>` に置換 (nested main 解消)
- A direction sticky header: 「#display_name」 h1 + 「N 件のツイート」 subtitle
- description は body 領域に muted text で表示
- 関連タグ pill を A direction tokens に (`var(--a-bg-muted)` + `var(--a-text-muted)`)
- focus-visible cyan outline 追加

## やらない

- TweetCardList 内部 styling — 別 issue
- Backend / API 変更

## テスト (E2E)

`client/e2e/tag-a-direction.spec.ts`:

### シナリオ 1

- **誰が**: 未ログイン
- **何をする**: /explore から最初の `/tag/...` link を辿る (なければ `/tag/python` を直叩き)
- **何が見える**: h1 が「#」 始まり + 単一 `<main>`

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
npx playwright test e2e/tag-a-direction.spec.ts
```
