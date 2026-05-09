# DM ルーム内 招待 UI 仕様

> 関連: [SPEC.md §7.2 グループ招待フロー](../SPEC.md), [docs/issues/phase-3.md](../issues/) (#XXX)
> Phase 3 follow-up — backend 完成済、UI 不足の解消

## 1. 背景

現状 `/messages` トップに「招待」link (受信箱) と「+ 新規グループ」button があり、グループ作成 _時_ にしか招待を送れない。SPEC §7.2 の「グループ作成者が招待」を満たすには **既存 room の中から後から招待を送れる UI** が必要。Slack/Discord/Teams など標準のチャットアプリではすべて room 内導線を持つ。

backend (`POST /api/v1/dm/rooms/<id>/invitations/`) は P3-04 (#229) で完成しているので、本変更は **UI 追加のみ**。

## 2. やること / やらないこと

### やる

- `RoomChat` ヘッダ右側に「+ 招待」button 追加 (group room かつ自分が creator のとき限定)
- 押下で `InviteMemberDialog` (Radix Dialog) が開く
- ダイアログ内で `@handle` 入力 (1 名ずつ) → POST `/api/v1/dm/rooms/<id>/invitations/`
- 成功 → トースト的フィードバック (`role="status"`) + ダイアログ閉じる
- 失敗 (404 user not found / 409 既に member / 429 rate limit / 403 not creator) → `role="alert"` でメッセージ表示
- pending invitation 一覧は本ダイアログ内では出さない (invitee 側の受信箱は `/messages/invitations` 既存)

### やらない (out of scope, follow-up)

- ハンドル autocomplete / インクリメンタル検索 (現状 user search endpoint なし、別 Issue)
- creator 以外 / direct room の招待 (SPEC §7.2 で creator のみと確定)
- 招待を送ったあとに invitee 側へ即時 push (Phase 4A 通知で別途配信)
- まとめて複数人招待 (1 ダイアログで 1 件、連続呼び出しで対応可能)
- 既に room メンバーの user 一覧を modal 内で見せる (将来の `RoomMembersDialog` で別途)

## 3. UI 詳細

### 3.1 RoomChat ヘッダ

```
┌─────────────────────────────────────────────┐
│ ← 一覧  Group名     [+ 招待] ●オンライン     │ ← 新 button
└─────────────────────────────────────────────┘
```

- button 表示条件: `room.kind === "group"` **AND** `room.creator_id === currentUserId`
- direct room、または creator でない参加者には button 自体を非表示 (server 側でも 403 で守られているが、UI で見えないこと自体が安全)
- aria-label: `"このグループに招待"`
- 視覚: `border + px-2 py-1 text-xs`、SocketStatusBadge と並べて right-align

### 3.2 InviteMemberDialog

Radix `Dialog` (既存 `@/components/ui/dialog`)。

```
┌── このグループに招待 ───────────────[×]──┐
│                                          │
│  招待するユーザーの @handle を入力        │
│  ┌──────────────────────────────────┐    │
│  │ @                                │    │
│  └──────────────────────────────────┘    │
│  例: alice                                │
│                                          │
│  [キャンセル]               [招待を送る] │
└──────────────────────────────────────────┘
```

- `<input>` は `@` プレフィックス受容 (GroupCreateForm と同じ正規化: `@alice`/`alice` → `alice`)
- 送信中は button `aria-busy="true"` + disable
- 成功時: `role="status"` で `招待を送信しました` 表示 → 1.2s 後ダイアログ閉じる
- バリデーション error / API error は `role="alert"` で表示。エラー消化:
  - 空文字 → `@handle を入力してください`
  - 不正文字 (`/`, `..`, 空白): `@handle に使用できない文字が含まれています`
  - 404: `@<handle> というユーザーは見つかりません`
  - 409 (`already_member` / `pending_invitation`): `@<handle> は既にメンバー / 招待済みです`
  - 403 (`not_creator`): `招待権限がありません` (creator 以外はそもそも button が見えないので想定外)
  - 429: `招待の上限 (50 件/日) に達しました`
- ESC キー / overlay クリック / × button で閉じる (Radix デフォルト)
- 招待成功時に `RoomChat` への副作用は無し (room メンバー一覧は accept 後に backend が自動更新する)

### 3.3 a11y

- ダイアログ open 時に input にフォーカスを移す (Radix の autofocus)
- 送信中はキーボード Tab 順序が button → input → button のループに入らないよう disable で除外
- `<form>` で submit を Enter キーでもトリガー
- ESC / × button から exit 可能 (WCAG 2.2 AA: 2.1.2 No Keyboard Trap)

## 4. API (backend は実装済)

### `POST /api/v1/dm/rooms/<id>/invitations/`

Request:

```json
{ "invitee_handle": "alice" }
```

Response 201:

```json
{
	"id": 123,
	"room_id": 7,
	"room_name": "プロジェクト相談室",
	"inviter_id": 5,
	"inviter_handle": "test2",
	"invitee_id": 9,
	"invitee_handle": "alice",
	"accepted": null,
	"responded_at": null,
	"created_at": "2026-05-09T12:34:56+09:00",
	"updated_at": "2026-05-09T12:34:56+09:00"
}
```

Errors:

- 400 — invitee_handle 不正、direct room、自己招待
- 403 — inviter が creator でない / not authenticated
- 404 — invitee handle 該当 user なし
- 409 — 既に member、または pending invitation 既に存在 (idempotent: 既存 invitation が再返却されるケースもあり)
- 429 — invitation rate limit (50/日)

## 5. 状態遷移 (再掲)

```
[creator が招待送信] → invitation.accepted=null (pending)
                         │
                         ├── invitee が accept → membership 追加、accepted=true
                         └── invitee が decline → accepted=false (再招待は新規 invitation で可)
```

## 6. テスト

### 6.1 vitest (RTL)

- `RoomChat` (group + creator): 「招待」 button が visible
- `RoomChat` (group + non-creator): button 非表示
- `RoomChat` (direct): button 非表示
- `InviteMemberDialog`: `@alice` 入力 → 送信 → mocked POST 201 → success status
- `InviteMemberDialog`: 空文字で submit → role=alert
- `InviteMemberDialog`: 404 → `見つかりません` alert
- `InviteMemberDialog`: 409 → `既にメンバー` alert
- `InviteMemberDialog`: ESC で onOpenChange(false)

### 6.2 Playwright UI E2E (`dm-room-invite.spec.ts`)

stg 上で 2 ユーザー (USER1=test2 = creator、USER2=test3 = invitee) を使う。

1. USER1 として login → 既存 group room (PLAYWRIGHT\*GROUP_ROOM_ID) を開く → 「招待」button 押下 → modal 出る
2. modal で `@test3` 入力 → 送信 → success status
3. USER1 logout、USER2 として login → `/messages/invitations` を開く → 該当招待が listing に存在
4. 「承諾」押下 → invitee side で room が見えるようになることを確認
5. クリーンアップ: USER2 が room から leave (もしくは USER1 が group を delete) — 現状 leave/delete API があれば呼ぶ、無ければ stg 状態をそのまま

> ⚠️ stg DB の汚染を最小化するため、E2E 開始時に既存の pending invitation を accept/decline で消すクリーンアップ step を入れる。

## 7. UI 不足 / 既出来 切り分け表

| 機能                                                       | backend | frontend | 本 PR         |
| ---------------------------------------------------------- | ------- | -------- | ------------- |
| 新規 group 作成時に招待 (`POST /rooms/` `invitee_handles`) | ✅      | ✅       | ―             |
| 既存 room に後から招待 (`POST /rooms/<id>/invitations/`)   | ✅      | ❌       | ✅            |
| 自分宛て pending 招待一覧 (`GET /invitations/`)            | ✅      | ✅       | ―             |
| 招待を承諾 (`POST /invitations/<id>/accept/`)              | ✅      | ✅       | ―             |
| 招待を拒否 (`POST /invitations/<id>/decline/`)             | ✅      | ✅       | ―             |
| handle autocomplete (user search)                          | ❌      | ❌       | ❌ (別 Issue) |
| room メンバー一覧表示 (`/rooms/<id>/` の memberships)      | ✅      | ❌       | ❌ (別 Issue) |
| 招待を取り消す (`DELETE /invitations/<id>/`)               | ❌      | ❌       | ❌ (別 Issue) |

## 8. 想定スケジュール

1 PR で完結予定。<200 行の UI 追加。

## 9. 関連 Issue / PR

- 本 spec の Issue: 後で追記
- backend 招待 API: PR #258 (Issue #229) で実装済
- 1:1 / グループ作成 UI: PR #239 (Issue #233) / PR #248 (Issue #236)
- 招待リスト UI: PR #248 (Issue #237)
