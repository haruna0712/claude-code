# /settings A direction polish (#577 Phase B-1-6)

## 背景

#574 (B-1-5) で /notifications を polish 済。次は **/settings 4 ページ** (profile, notifications, blocks, mutes)。各 page が独自 wrapper で sticky header が無い。ModerationListClient は内部に `<main>` を持っており (template)/layout の `<main>` と nested。

## 期待動作

### `/settings/profile`

- 外側 wrapper を `<div>` に置換 + sticky header (「プロフィール編集」 h1 + 「表示名 / bio / 画像 / 外部リンク」 subtitle)
- ProfileEditForm は無変更

### `/settings/notifications`

- bare `<div>` を sticky header + `<div>` に
- NotificationSettingsForm の内部 `<h1>` を `<h2>` に降格 + `text-baby_red` を `text-[color:var(--a-danger)]` に

### `/settings/blocks`, `/settings/mutes`

- bare コンポーネント render を sticky header + `<div>` でラップ
- ModerationListClient の外側 `<main>` を `<section>` に置換 (nested main 解消) + 内部 `<h1>` を `<h2>` に降格
- `text-gray-900 dark:text-gray-100` を `text-[color:var(--a-text)]` に

## やらない

- ProfileEditForm 内部 styling — 別 issue
- 通知 toggle / mute / block の機能変更 — 範囲外

## テスト (E2E)

`client/e2e/settings-a-direction.spec.ts`:

### シナリオ 1: /settings/profile

- ログイン済 (test2) で `/settings/profile` を開く → sticky header の「プロフィール編集」 h1 + 単一 `<main>`

### シナリオ 2: /settings/notifications

- ログイン済で `/settings/notifications` を開く → 「通知の設定」 h1 + 単一 `<main>`

### シナリオ 3: /settings/blocks

- ログイン済で `/settings/blocks` を開く → 「ブロック中のユーザー」 h1 + 単一 `<main>`

### シナリオ 4: /settings/mutes

- ログイン済で `/settings/mutes` を開く → 「ミュート中のユーザー」 h1 + 単一 `<main>`

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/settings-a-direction.spec.ts
```
