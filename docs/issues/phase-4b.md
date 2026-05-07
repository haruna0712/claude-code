# Phase 4B: モデレーション — Issue 一覧ドラフト

> Phase 目標: X 風の Block / Mute / Report を実装し、TL / 検索 / DM / 通知 全体に反映、stg で動作確認する
> マイルストーン: `Phase 4B: モデレーション`
> バージョン: **v1**
> 関連: [SPEC.md §14](../SPEC.md), [ER.md §2.12](../ER.md), [moderation-spec.md](../specs/moderation-spec.md), [moderation-scenarios.md](../specs/moderation-scenarios.md), [moderation-e2e-commands.md](../specs/moderation-e2e-commands.md)
>
> 設計判断:
>
> - Block: 双方向 (`apps.common.blocking.is_blocked_relationship` の lazy-import が活性化)
> - Mute: 一方向 (新規に `apps.common.muting.is_muted_by` を追加)
> - Block/Mute 共存時は Block 優先 (どちらも非表示なので結果は同じ)
> - Block 作成で follow 関係を双方向自動解消
> - Mute は DM / Quote tweet 経由表示には適用しない (X 準拠)
> - 既存のリアクション / Quote は Block 後も保持 (新規のみ拒否)
> - Report.target_id は CharField(64) (ER.md §2.12 の UUIDField から変更、Phase 4A Notification と整合)
> - Phase 5 (boards) への Block/Mute 反映は本 Phase スコープ外 (別 follow-up issue)

---

## P4B-01. [feature][backend] Block モデル + API + follow 自動解消

- **Labels**: `type:feature`, `layer:backend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M

### 目的

`apps/moderation/models.py::Block` を実装し、双方向 Block の lazy-import shim (`apps.common.blocking`) を活性化。

### 作業内容

- [ ] `Block` model (blocker / blockee / created_at、unique_together、CheckConstraint で自己 block 禁止)
- [ ] migration 0001
- [ ] `BlockSerializer` / `BlockListView` (GET 自分の一覧) / `BlockCreateView` (POST handle で blockee 解決)
- [ ] `POST /api/v1/moderation/blocks/` で Block 作成 + 同 transaction で `Follow.objects.filter(Q(follower=blocker, followee=blockee) | Q(follower=blockee, followee=blocker)).delete()`
- [ ] `DELETE /api/v1/moderation/blocks/<handle>/` で解除
- [ ] throttle: `moderation_block` 30/hour
- [ ] tests/test_block_model.py / test_block_api.py

### 受け入れ基準

- [ ] Block 作成で follow 関係双方向削除 (テスト)
- [ ] 自己 block で 400 (`code="self_target"`)
- [ ] 既存 timeline / dm / follows の `is_blocked_relationship` 経路がテストで検証される
- [ ] 重複 block で idempotent

---

## P4B-02. [feature][backend] Mute モデル + API + helper

- **Labels**: `type:feature`, `layer:backend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: S

### 目的

`Mute` model + lazy-import helper `apps.common.muting.is_muted_by(viewer, target)`、API。

### 作業内容

- [ ] `Mute` model (muter / mutee / created_at、unique_together、自己 mute 禁止)
- [ ] `apps/common/muting.py` 新規 (blocking.py と同じ lazy-import 形式)
- [ ] `POST /api/v1/moderation/mutes/` / `DELETE /api/v1/moderation/mutes/<handle>/` / `GET /api/v1/moderation/mutes/`
- [ ] throttle 30/hour

### 受け入れ基準

- [ ] 自己 mute で 400
- [ ] 一覧 API が自分の mute 行のみ返す
- [ ] `is_muted_by(a, b)` が a の mute 関係のみチェックする (双方向ではない)

---

## P4B-03. [feature][backend] Mute フィルタを timeline / notifications に組み込み

- **Labels**: `type:feature`, `layer:backend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M
- **Depends-on**: P4B-02

### 目的

Mute を home TL と通知作成時に反映。

### 作業内容

- [ ] `apps/timeline/services.py`: home / following TL クエリで `~Q(author_id__in=Mute.objects.filter(muter=viewer).values('mutee_id'))` を追加
- [ ] `apps/notifications/services.py::create_notification`: `is_muted_by(recipient, actor)` が True なら skip (mention/like/repost/reply/quote/follow 全 kind)
- [ ] tests: 既存 timeline テスト + notification テストに Mute シナリオ追加

### 受け入れ基準

- [ ] Mute 中の user の tweet が viewer の home TL に出ない
- [ ] Mute 中の actor が mention しても通知が作成されない
- [ ] DM は引き続き届く (Mute 適用しない)
- [ ] Quote tweet 経由は表示される (引用元 user の Mute は伝播しない、X 準拠)

---

## P4B-04. [feature][backend] Report モデル + 提出 API + admin 画面

- **Labels**: `type:feature`, `layer:backend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M

### 目的

通報の提出 + admin での閲覧 / 解決管理。

### 作業内容

- [ ] `Report` model (reporter / target_type / target_id (CharField 64) / reason / note / status / resolved_at / resolved_by)
- [ ] `POST /api/v1/moderation/reports/` で提出 (target 存在検証、自己 target 禁止)
- [ ] throttle: `moderation_report` 5/hour
- [ ] `apps/moderation/admin.py`: list_filter (target_type / status / reason)、search_fields (note)、bulk action (resolved にする)、resolved_by を current admin に自動設定

### 受け入れ基準

- [ ] 5 種別 × 5 理由のマトリクス全 pass
- [ ] target 存在しない / 削除済み tweet で 400 (`code="invalid_target"`)
- [ ] 自己通報で 400 (`code="self_target"`)
- [ ] throttle 6 件目で 429
- [ ] admin 画面で status 変更時 `resolved_at` / `resolved_by` 自動 set

---

## P4B-05. [feature][backend] config.settings に throttle scope 3 種追加

- **Labels**: `type:feature`, `layer:backend`, `area:moderation`, `priority:medium`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: S

### 目的

throttle scope を base.py に登録 (P4B-01/02/04 が依存)。

### 作業内容

- [ ] `DEFAULT_THROTTLE_RATES` に `moderation_block`, `moderation_mute`, `moderation_report` を追加 (stg は 10x で緩める既存パターンに沿う)

### 受け入れ基準

- [ ] settings test pass (既存 throttle test の expand)

---

## P4B-06. [feature][frontend] Profile kebab menu (DropdownMenu)

- **Labels**: `type:feature`, `layer:frontend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M
- **Depends-on**: P4B-01, P4B-02

### 目的

`/u/<handle>` プロフィールヘッダーに kebab メニュー追加 (画像参照: ミュート / ブロック / 通報する)。

### 作業内容

- [ ] shadcn `DropdownMenu` を使った ProfileKebab.tsx
- [ ] `/u/[handle]/page.tsx` の FollowButton 横に配置 (自分自身では非表示)
- [ ] Block / Mute は楽観的 toggle、`AlertDialog` で確認後 API 呼び出し
- [ ] ボタン文言を Block/Mute 状態で切替 (例: 「ブロック」⇄「ブロック解除」)
- [ ] a11y: kebab `aria-label`, alertdialog `role="alertdialog"`

### 受け入れ基準

- [ ] 自分のプロフィールで kebab 非表示
- [ ] 他人のプロフィールで 3 項目表示
- [ ] Block 確定後、UI 上で follow 状態がリセットされる

---

## P4B-07. [feature][frontend] Tweet kebab に通報追加 + ReportDialog

- **Labels**: `type:feature`, `layer:frontend`, `area:moderation`, `priority:high`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M
- **Depends-on**: P4B-04

### 目的

ツイート / レスの kebab に「通報」、汎用 ReportDialog を実装。

### 作業内容

- [ ] `client/src/components/moderation/ReportDialog.tsx` (Dialog + RadioGroup + Textarea)
- [ ] `TweetCard.tsx` 既存 kebab に「通報」項目を追加 (自分のツイートには出さない)
- [ ] 送信成功 toast、429 / 400 エラー表示
- [ ] a11y: `aria-modal`, focus trap, ESC 閉じ
- [ ] Profile kebab の「通報する」も同 Dialog を target_type='user' で再利用

### 受け入れ基準

- [ ] 理由未選択時送信ボタン disabled
- [ ] 成功 → モーダル閉じ + toast
- [ ] 429 → モーダル内エラー表示

---

## P4B-08. [feature][frontend] /settings/blocks /settings/mutes 一覧画面

- **Labels**: `type:feature`, `layer:frontend`, `area:moderation`, `priority:medium`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: S
- **Depends-on**: P4B-01, P4B-02

### 目的

設定画面でブロック / ミュート中ユーザーを一覧 + 解除可。

### 作業内容

- [ ] `/settings/blocks/page.tsx` と `/settings/mutes/page.tsx`
- [ ] 各行: avatar / display_name / @handle / 「解除」ボタン
- [ ] 空状態メッセージ
- [ ] LeftNavbar SettingsMenu に項目追加

### 受け入れ基準

- [ ] 一覧表示 + 解除 → 行が消える
- [ ] 空状態が表示される

---

## P4B-09. [feature][frontend] API client + boards.ts と同パターンの helper

- **Labels**: `type:feature`, `layer:frontend`, `area:moderation`, `priority:medium`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: S
- **Depends-on**: P4B-01, P4B-02, P4B-04

### 目的

`client/src/lib/api/moderation.ts` で 7 endpoint を型付き wrapper 化。

### 作業内容

- [ ] `block(target_handle)` / `unblock(target_handle)` / `listBlocks()`
- [ ] `mute(target_handle)` / `unmute(target_handle)` / `listMutes()`
- [ ] `report(payload)` (target_type / target_id / reason / note)
- [ ] tweets.ts と同じ AxiosInstance optional 引数パターン
- [ ] vitest MockAdapter テスト

### 受け入れ基準

- [ ] テスト 7+ ケース緑 (boards.test.ts と同形式)
- [ ] tsc / eslint clean

---

## P4B-10. [test][moderation] Playwright E2E + RTL + ROADMAP 反映

- **Labels**: `type:feature`, `layer:frontend`, `area:moderation`, `priority:medium`
- **Milestone**: `Phase 4B: モデレーション`
- **Estimate**: M
- **Depends-on**: 全 P4B

### 目的

`client/e2e/moderation-scenarios.spec.ts` で B-01..R-06 + U-01..U-06 をカバー。ROADMAP.md Phase 4B を完了マークに更新。

### 作業内容

- [ ] Playwright spec (api 直叩き + UI smoke の混合、boards-scenarios.spec.ts と同形式)
- [ ] ReportDialog の RTL テスト
- [ ] Profile kebab の RTL テスト
- [ ] ROADMAP.md Phase 4B 行 + タスクリストを `[x]` に

### 受け入れ基準

- [ ] Playwright 緑 (chromium)
- [ ] a11y / security の重大指摘なし
