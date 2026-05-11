# /u/[handle] A direction polish (#568 Phase B-1-2)

## 背景

#564 (B-1-0) で全 page A direction shell に統一、#566 (B-1-1) で /articles を polish。次にプロフィール (`/u/[handle]`) を A direction に整合させる。

## 期待動作

### `/u/[handle]` (プロフィール本体)

- 最上部に **sticky header**: 表示名 + @handle (固定で見える状態)
- 外側 wrapper を `<div>` に変更 ((template)/layout の `<main>` と二重ネスト解消)
- タブ active underline を `bg-primary` から **cyan `var(--a-accent)`** に
- SNS link (GitHub / X / Zenn 等) の hover を `hover:text-indigo-500 dark:hover:text-lime-400` から **`hover:text-[color:var(--a-accent)]`** に
- 既存 component (Header image / Avatar / FollowButton / StartDMButton / ProfileKebab / TweetCardList) は無変更

### `/u/[handle]/followers`

- 最上部に **sticky header**: 「← @handle」 戻る link + 「フォロワー」 タイトル + 表示名
- 外側 wrapper を `<div>` に変更

### `/u/[handle]/following`

- 同様に sticky header + `<div>` wrapper

## やらない

- TweetCard / TweetCardList の dark theme 残骸 — 別 issue
- FavoritesTab の light theme 化 — 別 issue
- ProfileEditForm (settings) — Phase B-1-? settings 系
- Avatar / header image の `next/image` 化 — 別 issue
- ProfileKebab / FollowButton / StartDMButton の styling — 別 issue

## テスト (E2E)

`client/e2e/profile-a-direction.spec.ts` で stg を踏む。

### シナリオ 1: プロフィール構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/u/test2` を開く
- **何が見える**:
  - `getByRole('main')` が **1 件のみ** (layout 側)
  - sticky header に表示名 + @test2 が見える
  - 「ポスト」 「いいね」 タブが見える

### シナリオ 2: フォロワー一覧の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/u/test2/followers` を開く
- **何が見える**:
  - `getByRole('main')` が 1 件のみ
  - sticky header に 「← @test2」 戻る link + 「フォロワー」 heading

### シナリオ 3: フォロー中一覧の構造

- **誰が**: 未ログイン訪問者
- **何をする**: `/u/test2/following` を開く
- **何が見える**:
  - `getByRole('main')` が 1 件のみ
  - sticky header に 「← @test2」 戻る link + 「フォロー中」 heading

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/profile-a-direction.spec.ts
```
