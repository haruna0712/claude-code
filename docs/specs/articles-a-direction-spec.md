# /articles A direction polish (#566 Phase B-1-1)

## 背景

#564 (B-1-0) で `(template)/layout.tsx` を A direction shell に統一した結果、
`/articles` 配下も A 直格子に乗ったが、本文側にいくつかの残骸:

- 外側 `<main>` が (template)/layout の `<main>` と **二重ネスト** (invalid HTML)
- 「記事を書く」 CTA が shadcn `bg-primary` で A accent (cyan) と色が衝突
- 他 A direction page (`/`) と違って sticky header が無く一貫性に欠ける

## 期待動作

### `/articles` (一覧)

- 最上部に **sticky header**: 「記事」 タイトル + filter 説明 + 右に「記事を書く」 cyan pill button
- header 直下に記事カード一覧 (`ArticleCard` を使った Zenn 風)
- 外側 wrapper は `<div>` (layout 側の `<main>` と二重ネストしない)
- 記事ゼロのとき empty state パネル

### `/articles/<slug>` (詳細)

- 最上部に **sticky header**: 「記事」 + 戻る link (`/articles`)
- 本文は `<article>` で囲み (HTML semantic)、外側 `<main>` を撤廃
- 既存の OGP / JSON-LD は維持

### `/articles/new` (新規作成)

- 最上部に **sticky header**: 「記事を書く」 + 戻る link (`/articles`)
- 外側 wrapper は `<div>`、ArticleEditor をそのまま埋め込み

### `/articles/<slug>/edit` (編集)

- 最上部に **sticky header**: 「記事を編集」 + 戻る link (`/articles/<slug>`)
- 外側 wrapper は `<div>`、ArticleEditor を edit mode で埋め込み

## やらない

- ArticleEditor (Markdown editor) 内部の styling 変更
- ArticleBody (prose) の dark:prose-invert 削除 (light でも問題なし)
- Backend API / model 変更

## テスト (E2E)

`client/e2e/articles-a-direction.spec.ts` で stg を踏む。

### シナリオ 1: 一覧の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/articles` を開く
- **何が見える**:
  - `getByRole('main')` が **1 件のみ** (layout 側の main、page 側は div)
  - `getByText('記事')` heading が見える
  - 「記事を書く」 link/button が見える、href=/articles/new
  - sticky header が viewport top にいる (CSS が適用済)

### シナリオ 2: 詳細の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/articles/<existing-slug>` を開く (stg に既存の公開記事を 1 つ用意)
- **何が見える**:
  - `getByRole('main')` が 1 件のみ
  - 記事 title が h1 で表示
  - 「記事一覧へ戻る」 link が sticky header にある

### シナリオ 3: 新規作成の構造

- **誰が**: ログイン済ユーザー (test2)
- **何をする**: `/articles/new` を開く
- **何が見える**:
  - sticky header に「記事を書く」
  - 編集 form が見える (`ArticleEditor`)

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/articles-a-direction.spec.ts
```
