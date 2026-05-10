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
3. **(NEW) #487 通知検証**: USER2 として login し `GET /api/v1/notifications/` を fetch、`kind=dm_invite` のエントリが存在し `actor.handle === "test2"` であることを assert。SPEC §7.5 / §8.1 のアプリ内通知配信を担保する。
4. USER1 logout、USER2 として login → `/messages/invitations` を開く → 該当招待が listing に存在
5. 「承諾」押下 → invitee side で room が見えるようになることを確認
6. クリーンアップ: USER2 が room から leave (もしくは USER1 が group を delete) — 現状 leave/delete API があれば呼ぶ、無ければ stg 状態をそのまま

> ⚠️ stg DB の汚染を最小化するため、E2E 開始時に既存の pending invitation を accept/decline で消すクリーンアップ step を入れる。
> 加えて、#487 検証のため事前に test3 の `dm_invite` 既存通知も clear しておく (`/notifications/<id>/` mark-as-read で十分。完全削除は API 無し)。

### 6.3 通知配信 (#487 — Phase 4A bridge)

backend は招待作成時に `apps/dm/services.py:invite_user_to_room` 内で
`transaction.on_commit(lambda: emit_dm_invite(invitation))` を fire する。
`apps/dm/integrations/notifications.py` がプロセス起動時に
`apps.notifications.signals.emit_notification` を resolve し、解決できれば
`create_notification(recipient, kind, actor, target_type, target_id)` で
`Notification` を永続化する。

- target_type = `"invitation"`、target_id = `invitation.pk`
- self-skip / 設定 OFF skip / dedup 24h / Block / Mute フィルタは
  `create_notification` 側で適用 (本 spec 範囲外、別 SPEC §8 参照)
- pytest: `apps/notifications/tests/test_signals_bridge.py` で bridge を直接検証
- E2E: §6.2 step 3 で実機検証

## 7. 通知 inline action (#489 — 通知から直接 承諾/拒否)

### 7.1 UX 仕様

他チャットサービス調査:

| アプリ          | 招待通知 UX                                              |
| --------------- | -------------------------------------------------------- |
| Slack           | 受信箱 button「Join」(別画面)                            |
| Discord         | 通知に **インライン** `Accept / Reject` button、即時参加 |
| Microsoft Teams | 通知に `Join` button、即時参加                           |
| LINE            | 通知に「参加」「拒否」 button、即時参加                  |

= 標準は **「通知に inline action button」**。受信箱への navigate を不要にする。

本アプリでも `/notifications` ページの `dm_invite` 通知行に **承諾 / 拒否 button** を render する。`/messages/invitations` (受信箱) は alternative entry として残し、片方だけのフローに依存しない。

### 7.2 描画条件

`NotificationItem.kind === "dm_invite"` AND `target_type === "invitation"` AND `target_id` 存在。
旧通知 (Phase 4A bridge 修正前のもの、`target_type=""`) には button を出さない (target_id が無いと API が叩けない)。

### 7.3 動作

- 承諾 → `POST /api/v1/dm/invitations/<target_id>/accept/`
  - 成功: `role=status` で「参加しました」表示 → 1.5s 後 row を listing から remove + 通知を read 化
  - 失敗 (4xx): `role=alert` でメッセージ
- 拒否 → `POST /api/v1/dm/invitations/<target_id>/decline/`
  - 成功: `role=status` で「拒否しました」 → 1.5s 後 row remove + read 化
  - 失敗: 同上
- 送信中は両 button `disabled + aria-busy`
- 操作後の通知 row は再 render しない (UX が静止)

### 7.4 a11y

- button は `aria-label` に handle / kind を含めて screen reader でも目的が分かる
- 承諾 / 拒否 button は通知 row の Link 内ではなく **外側** に配置 (button-in-link は ARIA 非推奨)
- 通知行全体の Link href は target_type=invitation のとき `/messages/invitations` にしておき、最低限の到達性を保つ

### 7.5 ベル dropdown は別 Issue

ヘッダのベルアイコン dropdown (Phase 4A 末で追加予定) も同 component を流用するが、サイズが小さいため inline button 表示有無は別仕様。本 spec は `/notifications` ページに限定する。

## 8. メンバー削除 / 退室 (#492)

### 8.1 UX 仕様

他チャットサービス調査:

| アプリ          | kick UX                             | leave UX                      |
| --------------- | ----------------------------------- | ----------------------------- |
| Slack           | Channel admin が member 行 → Remove | Sidebar context menu「Leave」 |
| Discord         | Server owner / mod が member → Kick | Server menu「Leave Server」   |
| Microsoft Teams | Team owner が member 行 → Remove    | Team menu「Leave team」       |
| LINE            | Admin が member 長押し → 削除       | グループ画面「退会」          |

= 標準は **「member 一覧から削除/退会」**。本アプリも `RoomMembersDialog` 内で完結。

### 8.2 描画条件

- **kick (削除) button**: 各 member 行の右側
  - 表示条件: `currentUser === room.creator_id` AND `member.user_id !== room.creator_id` AND `member.user_id !== currentUser`
  - direct room では Dialog 自体が出ないため考慮不要
- **leave (退室) button**: ダイアログ最下部
  - 表示条件: 全メンバー (group のみ、direct は Dialog 自体出ない)
  - creator も leave 可能 (backend `leave_room` 内で残メンバー最古から自動 ownership transfer)

### 8.3 動作

- 削除 → `window.confirm("@<handle> をこのグループから削除しますか？")` → OK で `DELETE /api/v1/dm/rooms/<id>/members/<user_id>/`
  - 成功: row 自動消去 (RTK Query invalidate で再 fetch)
  - 失敗: `role=alert` で「@<handle> の削除に失敗しました」
- 退室 → `window.confirm("このグループを退室しますか？...")` → OK で `DELETE /api/v1/dm/rooms/<id>/membership/`
  - 成功: Dialog close + `/messages` に redirect (`onLeftRoom` callback)
  - 失敗: `role=alert` で「退室に失敗しました」
- 送信中は両 button `disabled + aria-busy`

### 8.4 a11y

- button は `aria-label` に handle / 操作 を含む (例: `@bob を削除`、`このグループを退室`)
- 確認 dialog はネイティブ `window.confirm` (キーボード操作対応 / SR 対応)
- 将来的には Radix `AlertDialog` への置き換えを検討 (本 spec 範囲外)

### 8.5 backend API

#### `DELETE /api/v1/dm/rooms/<id>/members/<user_id>/` (新規)

- 認可: room creator のみ。kicker が membership 持たない場合は 404 で room 隠蔽
- target=creator は 400「creator 自身は削除できません」
- target が member でない場合は 400「対象ユーザーはこのルームのメンバーではありません」
- direct room は 400「1:1 room ではメンバー削除はできません」
- 成功: 204 No Content、`DMRoomMembership` 物理削除

#### `DELETE /api/v1/dm/rooms/<id>/membership/` (既存、P3-04)

- self-leave。creator が leave すると残メンバー最古に ownership transfer

### 8.6 E2E spec (`client/e2e/dm-kick-leave.spec.ts`)

stg 上で 2 シナリオを 1 spec で踏破:

- **KICK-FLOW**: USER1 (creator) が UI 経由でメンバー dialog → 削除 button → confirm → kick → memberships から USER2 が消えていることを API で assert
- **LEAVE-FLOW**: USER2 が UI 経由でメンバー dialog → 退室 button → confirm → leave → `/messages` redirect + room access が 404 化していることを assert

導線:

```
/messages/<group_room_id>
 → header の「メンバー <count>」 button click  ← 📍 entry point
 → RoomMembersDialog
   → 各 member 行 (creator 視点 + 非 creator member) に「削除」 button
   → ダイアログ最下部に「このグループを退室」 button
```

env:

- `PLAYWRIGHT_GROUP_ROOM_ID` — kick 用 (USER1 = creator の group room)
- `PLAYWRIGHT_LEAVE_ROOM_ID` — leave 用 (USER2 が member の別 group room、kick と同じだと leave 後再 invite が必要になり面倒)

stg 実行で 2/2 GREEN (10.2s) 確認済 (2026-05-10)。

## 9. UI 不足 / 既出来 切り分け表

| 機能                                                       | backend | frontend | 状態       |
| ---------------------------------------------------------- | ------- | -------- | ---------- |
| 新規 group 作成時に招待 (`POST /rooms/` `invitee_handles`) | ✅      | ✅       | ―          |
| 既存 room に後から招待 (`POST /rooms/<id>/invitations/`)   | ✅      | ✅       | #476 完了  |
| 自分宛て pending 招待一覧 (`GET /invitations/`)            | ✅      | ✅       | ―          |
| 招待を承諾 (`POST /invitations/<id>/accept/`)              | ✅      | ✅       | ―          |
| 招待を拒否 (`POST /invitations/<id>/decline/`)             | ✅      | ✅       | ―          |
| 通知 inline action                                         | ✅      | ✅       | #489 完了  |
| handle autocomplete (user search)                          | ✅      | ✅       | #480 完了  |
| room メンバー一覧表示                                      | ✅      | ✅       | #479 完了  |
| 招待を取り消す (`DELETE /invitations/<id>/`)               | ✅      | ✅       | #481 完了  |
| **kick (member 削除) / leave (退室) UI (#492)**            | ✅      | ✅       | ✅ (本 PR) |

## 10. 想定スケジュール

#476 (room 内招待 button) は 1 PR で完結予定 (<200 行)。後続 follow-up (#479-#481, #489, #492) は各 1 PR。

## 11. 関連 Issue / PR

- room 内招待 UI: #476 / PR #477
- backend 招待 API: PR #258 (Issue #229) で実装済
- 1:1 / グループ作成 UI: PR #239 (Issue #233) / PR #248 (Issue #236)
- 招待リスト UI: PR #248 (Issue #237)
- 通知 bridge: #487 / PR #488 (dm_invite 通知が永続化されるよう修正)
- 通知 inline action: #489 / PR #490
- メンバー削除 / 退室: **#492 / 本 PR**
