# メンター募集 board (Phase 11 11-A) UI 仕様

> 関連: [phase-11-mentor-board-spec.md](./phase-11-mentor-board-spec.md) (全体 design doc)
> 関連シナリオ: [mentor-board-scenarios.md](./mentor-board-scenarios.md)
> e2e 実行: [mentor-board-e2e-commands.md](./mentor-board-e2e-commands.md)

Phase 11 11-A の **UI 詳細**。 backend API は phase-11 spec §6 / frontend route は §7 を参照し、 ここでは「画面に何が出るか / どう操作するか」 を user role 別に整理する。

## 画面構成

### `/mentor/wanted` 一覧

- sticky header: 🤝 icon + 「メンター募集」 + filterDescription (`#tag で募集中` or `募集中の相談`) + CTA
  - auth: 「募集を出す」 (青背景) → `/mentor/wanted/new`
  - anon: 「ログインして募集する」 → `/login?next=/mentor/wanted/new`
- body: cursor pagination で公開中 (status=open) のみ列挙、 各 row は
  - mentee handle / 投稿日付 / 提案件数
  - title (1 行 truncate)
  - 関連 skill tag chip (横並び)
- empty state: 「まだ募集がありません。 最初の募集を投稿してみませんか?」

### `/mentor/wanted/new` 投稿 form

- SSR auth gate (anon → /login?next=...)
- フィールド:
  - タイトル (1-80 字)
  - 本文 (1-2000 字、 改行 OK、 monospace placeholder)
  - 関連スキル (csv、 最大 5、 既存 tag のみ、 未登録は 400 error)
- submit → toast「募集を投稿しました」 + `/mentor/wanted/<id>` redirect

### `/mentor/wanted/<id>` 詳細

- sticky header: 「← 募集一覧」 + title + `@mentee_handle · 状態`
- 本文 (whitespace-pre-wrap で改行尊重) + skill tag chip
- **role 別 UI**:
  - **anon** + status=open: 「ログインして提案する」 CTA → `/login?next=/mentor/wanted/<id>`
  - **mentor 候補** (auth、 non-owner) + status=open: 提案 form
    - 本文 (1-2000) + 「提案を送る」 button
    - 送信成功で status panel「提案を送信しました。 mentee が accept すると DM ルームが開きます。」
    - unique 違反 (既に出した提案あり) は role=alert で error
  - **owner** (mentee): 受信 proposal リスト (新着順、 owner only API GET)
    - 各 proposal: mentor handle + 投稿日時 + status + 本文
    - status=pending + request.status=open のときだけ「accept」 button
    - accept click → contract 成立 → toast「契約成立しました。 DM ルームに移動します。」 + `/messages/<room_id>` redirect

### `/messages/<room_id>` (kind=mentorship)

- header 直下に role=status banner「🤝 メンタリング契約中の room です。」
- 一覧 (`/messages`) では avatar が 🤝 emoji + blue ring + aria-label「メンタリング」
- 既存 DM 機能 (typing / read / 添付) はそのまま使える

## アクセシビリティ

- 全 button / link に focus-visible outline (a11y-architect 流儀)
- role=alert / role=status を error / 完了通知に分離
- aria-label を accept button に明示 (「@<handle> の提案を accept」)
- screen reader でも「メンタリング契約中」 が読み上げられるよう banner は role=status + aria-live=polite

## 採用しない / 後回し

- proposal 投稿後の編集 / withdraw UI は P11-19 (RoomChat 完了時 read-only) 以降の Phase 11-C で対応
- proposal リストでの個別 reject button は MVP では出さない (放置 = pending)。 mentee が他 proposal を accept すると request.status=MATCHED に変わって他は表示されるが触らない (R8)
- mentor profile / plan / 検索画面は Phase 11-B (P11-11〜P11-16)
- 評価 / レビューは Phase 11-D (P11-20〜P11-22)

## 関連 PR / Issue

- P11-01〜P11-10 (11-A MVP)、 P11-08 で DM 識別 UI、 P11-09 で E2E 自動化
