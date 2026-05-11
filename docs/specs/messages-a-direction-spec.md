# /messages (DM) A direction polish (#572 Phase B-1-4)

## 背景

#570 (B-1-3) で /boards を polish 済。次は /messages (DM)。レガシーの `baby_white` / `baby_blue` / `baby_red` / `baby_grey` パレットが残っており、A direction の light + cyan と乖離。

## 期待動作

### `/messages` (一覧)

- auth 必須 (cookie `logged_in`)、未認証は `/login?next=/messages` に redirect (既存挙動維持)
- 最上部に **sticky header**: 「メッセージ」 h1 + 招待 link (+ pending badge cyan) + ＋新規グループ button (cyan)
- `baby_white` / `baby_blue` / `baby_red` / `baby_grey` を A direction tokens に置換
- 認証中 / プロフィール不正の loading / error state も A direction palette で表示

### `/messages/invitations`

- 最上部に **sticky header**: 「← メッセージ一覧」 戻る link + 「グループ招待」 h1
- 同上 palette 置換

### `/messages/[id]`

- 本 PR では outer wrapper + loading/error state のみ調整 (RoomChat 内部は別 issue)

## やらない

- RoomChat / RoomList / RoomListItem / MessageList / MessageBubble / MessageComposer / TypingIndicator / InvitationList の内部 styling — 別 issue (B-1-? DM internals)
- WebSocket / 既読 / 添付 / push 機能 — 範囲外

## テスト (E2E)

`client/e2e/messages-a-direction.spec.ts` で stg を踏む。

### シナリオ 1: 未ログインは /login にリダイレクト

- **誰が**: 未ログイン
- **何をする**: `/messages` を開く
- **何が見える**: `/login?next=/messages` に redirect

### シナリオ 2: ログイン済の /messages 構造

- **誰が**: ログイン済 (test2)
- **何をする**: `/messages` を開く
- **何が見える**:
  - 「メッセージ」 h1
  - 「招待」 link (`/messages/invitations`)
  - 「＋ 新規グループ」 button
  - 単一 `<main>`

### シナリオ 3: ログイン済の /messages/invitations 構造

- **誰が**: ログイン済 (test2)
- **何をする**: `/messages/invitations` を開く
- **何が見える**:
  - 「← メッセージ一覧」 link
  - 「グループ招待」 h1
  - 単一 `<main>`

## Playwright 実行

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
npx playwright test e2e/messages-a-direction.spec.ts
```
