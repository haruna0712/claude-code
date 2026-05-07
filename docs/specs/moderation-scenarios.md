# モデレーション (Moderation) — 受け入れシナリオ

> 関連: [moderation-spec.md](./moderation-spec.md), [moderation-e2e-commands.md](./moderation-e2e-commands.md), [SPEC.md §14](../SPEC.md)
>
> Gherkin 風の自然文。Playwright spec はこのシナリオを 1 対 1 でカバーする。

## Block

### B-01: ブロックすると双方向で TL から消える

**Given** A と B がそれぞれログイン可能で、両者がツイートを投稿している
**When** A が B をブロックする (`POST /moderation/blocks/`)
**Then** A の home TL から B のツイートが消える
**And** B の home TL から A のツイートが消える
**And** A の検索結果から B のツイートが消える

### B-02: ブロック中のフォロー試行は失敗

**Given** A が B をブロックしている
**When** B が A をフォローしようとする (`POST /users/A/follow/`)
**Then** 403 が返る (`code="blocked"`)

### B-03: ブロック中の DM 送信は失敗

**Given** A が B をブロックしている
**When** B が A への DM ルームを作成 / 送信しようとする
**Then** 403 が返る

### B-04: ブロック作成で既存フォローは双方向自動解消

**Given** A が B をフォロー、B が A をフォロー (相互)
**When** A が B をブロックする
**Then** Follow テーブルから A→B / B→A の 2 行が削除される
**And** /u/A/followers から B が消える
**And** /u/B/followers から A が消える

### B-05: ブロック解除で TL に新規ツイートから復帰

**Given** A が B をブロック中
**When** A が B のブロックを解除する (`DELETE /moderation/blocks/B/`)
**And** B が新しくツイートする
**Then** A の home TL に新ツイートが表示される (フォロー復活はしないため `following` タブには出ない)

### B-06: 自分自身をブロックできない

**When** A が `POST /moderation/blocks/` で `target_handle=A` を送信する
**Then** 400 が返る (`code="self_target"`)

### B-07: 既にブロック中のユーザーを重複ブロックしようとして冪等

**Given** A が B をブロック中
**When** A がもう一度 B をブロックしようとする
**Then** 200 もしくは 201 が返り Block 行は 1 つのまま (idempotent)

## Mute

### M-01: ミュート中の TL 非表示 (一方向)

**Given** A が B をミュート中
**When** B がツイートを投稿する
**Then** A の home TL に B のツイートが出ない
**And** B の home TL には A のツイートが出る (B 側は気付かない)

### M-02: ミュート中はメンション通知が来ない

**Given** A が B をミュート中
**When** B が `@A` を含むツイートを投稿する
**Then** A の `/notifications` に mention 通知が **作成されない**

### M-03: ミュート中もフォロー関係は維持

**Given** A が B をフォロー中
**When** A が B をミュートする
**Then** Follow 関係は影響を受けない (B 側に通知も飛ばない)

### M-04: ミュート中の DM は届く (Mute は DM に適用しない)

**Given** A が B をミュート中
**When** B が A に DM 送信する
**Then** DM ルームに通常通りメッセージが届く (DM は明示的選択行動なので Mute の対象外、X 準拠)

### M-05: ミュート解除で新規ツイートから TL 復帰

**Given** A が B をミュート中
**When** A が B のミュートを解除する
**And** B が新しくツイートする
**Then** A の home TL に新ツイートが表示される

### M-06: 自分自身をミュートできない

**When** A が `target_handle=A` でミュート送信
**Then** 400 (`code="self_target"`)

### M-07: ミュート中の Quote tweet は経由表示される (X 準拠)

**Given** A が B をミュート中
**And** C が B のツイートを quote している (C は A のフォロー中)
**When** A が home TL を開く
**Then** C の quote tweet は表示される (Mute は quote の引用元に伝播しない)

## Report

### R-01: 通報モーダルは理由未選択で送信できない

**Given** A がツイートの kebab → 通報する を開く
**When** 理由を選ばず送信ボタンを押そうとする
**Then** 送信ボタンが `disabled` で押せない

### R-02: 通報送信成功

**Given** A が B のツイートに対し通報モーダルを開く
**When** 理由「スパム」を選択し詳細「広告URL」と入力して送信
**Then** 201 が返る
**And** モーダルが閉じる
**And** toast「通報を受け付けました」が表示される
**And** admin の `/admin/moderation/report/` に新規行が pending status で記録される

### R-03: 通報レートリミット (5/hour)

**Given** A が直近 1 時間で 5 件通報済み
**When** 6 件目を送信する
**Then** 429 が返り、モーダルに「しばらく時間をおいて再度送信してください」と表示される

### R-04: 自分自身を通報できない

**When** A が `target_type="user"` `target_id=A.id` で通報送信
**Then** 400 (`code="self_target"`)

### R-05: 削除済みのツイートを通報しようとする

**Given** B がツイートを投稿後に soft-delete
**When** A が削除済みツイートを `target_type="tweet"` で通報送信
**Then** 400 (`code="invalid_target"`)

### R-06: admin が通報を解決済みにする

**Given** pending 状態の通報が admin にある
**When** admin が `/admin/moderation/report/<id>/change/` で status を `resolved` に変更
**Then** `resolved_at` が auto-set、`resolved_by` が admin user に設定
**And** 一覧で resolved フィルタにより絞り込める

## UI / a11y

### U-01: 自分のプロフィールには kebab 出ない

**Given** A がログイン中
**When** A が `/u/A` (自分のプロフィール) を開く
**Then** ⋯ ボタンは表示されない (代わりに「プロフィールを編集」ボタン)

### U-02: 他人のプロフィール kebab メニュー

**Given** A がログイン中、B のプロフィールを開いている
**When** A が ⋯ ボタンをクリック
**Then** ドロップダウンが開き、ミュート / ブロック / 通報する の 3 項目が表示される
**And** kebab ボタンに `aria-expanded="true"` が付与される

### U-03: ブロック確認 dialog

**When** A が kebab → ブロック をクリック
**Then** AlertDialog が開き「@B をブロックしますか?」と表示される
**And** ダイアログには `role="alertdialog"` が付く
**And** 確定ボタンでブロックが実行され、kebab メニューの項目が「ブロック解除」に変わる

### U-04: 通報モーダルは ESC で閉じる

**Given** 通報モーダルが開いている
**When** ESC キーを押す
**Then** モーダルが閉じる

### U-05: /settings/blocks で解除できる

**Given** A が B / C をブロック中
**When** A が `/settings/blocks` を開く
**Then** B と C の 2 行が表示される
**When** B 行の「解除」を押す
**Then** B が一覧から消え、A の home TL に B のツイートが (新規分から) 復帰する

### U-06: /settings/blocks 空状態

**Given** A はブロック中ユーザーがいない
**When** A が `/settings/blocks` を開く
**Then** 「ブロック中のユーザーはいません」と表示される
