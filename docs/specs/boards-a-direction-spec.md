# /boards A direction polish (#570 Phase B-1-3)

## 背景

#568 (B-1-2) で /u/[handle] を polish 済。次は **/boards** (掲示板)。5ch 風で dark theme 色 (`text-gray-900`, `dark:bg-gray-900`, `text-blue-600`) が多用されており、A direction の light + cyan accent と乖離。

## 期待動作

### `/boards` (一覧)

- 最上部に **sticky header**: 「掲示板」 + 「技術トピックごとに議論する場所」 subtitle
- 外側 wrapper を `<div>` に変更
- `BoardCard` 内の `text-gray-*` / `border-gray-*` / `bg-gray-*` / `dark:*` を A direction tokens に置換
- focus-visible outline を cyan accent に

### `/boards/[slug]` (詳細・スレ一覧)

- 最上部に **sticky header**: 「← 掲示板」 戻る link + 板 color dot + 板名 + 説明
- 外側 wrapper を `<div>` に変更
- `ThreadRow` 内の `text-gray-*` / `border-gray-*` / `bg-gray-*` / `dark:*` を A direction tokens に置換
- pagination link の `text-blue-600` を cyan `var(--a-accent)` に
- threads list の outer container を `border-[color:var(--a-border)] bg-[color:var(--a-bg)]` に

## やらない

- ThreadView (`/threads/[id]`) — 別 issue (B-1-? thread)
- ThreadComposer / PostComposer 本文 styling — 別 issue
- Backend / API 変更

## テスト (E2E)

`client/e2e/boards-a-direction.spec.ts` で stg を踏む。

### シナリオ 1: 板一覧の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/boards` を開く
- **何が見える**:
  - `getByRole('main')` が **1 件のみ**
  - sticky header に「掲示板」 が h1 で見える
  - 板が ≥1 件あれば BoardCard が見える (なければ empty state)

### シナリオ 2: 板詳細の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/boards` から最初の板 link を踏む → `/boards/<slug>` を開く
- **何が見える**:
  - `getByRole('main')` が 1 件のみ
  - sticky header に「← 掲示板」 戻る link + 板名 h1

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/boards-a-direction.spec.ts
```
