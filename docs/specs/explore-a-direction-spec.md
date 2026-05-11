# /explore A direction polish (#584 Phase B-1-9)

## 背景

#581 (B-1-8) で /tag/[name] を polish 済。次は /explore (未ログイン discovery surface)。

## 期待動作

- 外側 `<div mx-auto max-w-6xl>` を撤去して layout の 800px center grid に従わせる
- 外側 `<main>` を `<article>` に置換 (nested main 解消)
- sticky context bar (heading 抜き、HeroBanner の h1 が page heading)
- HeroBanner: `text-lime-500` / `bg-lime-500` → cyan A accent
- StickyLoginBanner: `bg-lime-500` → cyan A accent
- ログイン済は `/` にリダイレクト (既存挙動維持)

## やらない

- TweetCardList 内部 styling — 別 issue
- HeroBanner copy 変更 — 範囲外

## テスト (E2E)

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
npx playwright test e2e/explore-a-direction.spec.ts
```

シナリオ EXPLORE-A-1: 未ログインで /explore → sticky bar の「Explore」 + HeroBanner の h1「エンジニアによる」 + 「新規登録する」 link + 単一 `<main>`。
