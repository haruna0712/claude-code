# /search A direction polish (#586 Phase B-1-10 / Phase B-1 最終)

## 背景

#584 (B-1-9) /explore に続き、最後の page。/search を A direction に揃えて Phase B-1 完結。

## 期待動作

- 外側 `<main>` を `<div>` に置換 (nested main 解消)
- A direction sticky header (「検索」 h1 + query subtitle when set)
- SearchBox を header 直下の body に置く
- 検索結果カウントは sticky header の subtitle に集約
- 「上のボックスにキーワード」 ヒントは muted text

## やらない

- SearchBox 内部 styling — 別 issue
- TweetCardList 内部 styling — 別 issue

## テスト (E2E)

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
npx playwright test e2e/search-a-direction.spec.ts
```

- SEARCH-A-1: /search (no query) → sticky 「検索」 h1 + 単一 `<main>`
- SEARCH-A-2: /search?q=test → query subtitle + 結果 section + 単一 `<main>`
