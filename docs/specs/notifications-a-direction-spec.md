# /notifications A direction polish (#574 Phase B-1-5)

## 背景

#572 (B-1-4) で /messages を polish 済。次は /notifications。現状 `<div className="mx-auto w-full max-w-2xl"><NotificationsList /></div>` のみで sticky header が無く、他 A direction page と統一感に欠ける。NotificationsList 内に `text-baby_red` も残っている。

## 期待動作

- auth 必須 (cookie `logged_in`)、未認証は `/login` に redirect (既存挙動維持、SSR redirect)
- 最上部に **sticky header**: 「通知」 h1
- 外側 wrapper は `<div>` (本 PR 前から fragment-level、nested main 問題なし)
- NotificationsList の error state `text-baby_red` → `text-[color:var(--a-danger)]`

## やらない

- NotificationsList の row item 内部 styling (avatar / actor name / verb / timestamp / unread dot) — 別 issue
- 通知 kind 別アイコン色 — 別 issue
- フィルタ / ページネーション機能変更 — 範囲外

## テスト (E2E)

`client/e2e/notifications-a-direction.spec.ts`:

### シナリオ 1: 未ログインは /login にリダイレクト

- **誰が**: 未ログイン
- **何をする**: `/notifications` を開く
- **何が見える**: `/login` に redirect (SSR)

### シナリオ 2: ログイン済の構造

- **誰が**: ログイン済 (test2)
- **何をする**: `/notifications` を開く
- **何が見える**:
  - sticky header に 「通知」 h1
  - 単一 `<main>`

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/notifications-a-direction.spec.ts
```
