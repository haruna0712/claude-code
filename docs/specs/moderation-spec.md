# モデレーション (Moderation) — 詳細仕様

> Version: 0.1 (Phase 4B 着手時、2026-05-07)
> 関連: [SPEC.md §14.2/§14.3/§14.4](../SPEC.md), [ER.md §2.12](../ER.md), [ROADMAP.md Phase 4B](../ROADMAP.md), [moderation-scenarios.md](./moderation-scenarios.md), [moderation-e2e-commands.md](./moderation-e2e-commands.md)
>
> X (旧 Twitter) を参考にした Block / Mute / Report 機能 MVP の正本仕様。SPEC.md §14 と ER.md §2.12 を実装視点に正規化し、未確定だった `target_id` 型・既存リアクションの扱い・Mute と Quote の関係を確定する。

---

## 1. スコープ

### 1.1 本 Phase の対象

| 機能   | 概要                              | 効果                                                          |
| ------ | --------------------------------- | ------------------------------------------------------------- |
| Block  | 双方向の関係遮断                  | TL / 検索 / DM / フォロー / リアクション / 通知すべてで非表示 |
| Mute   | 一方向の非表示 (相手は気付かない) | 自分の TL / 通知 から相手の投稿を非表示                       |
| Report | 5 対象 × 5 理由の通報             | admin で一覧 / 解決管理                                       |

### 1.2 本 Phase 対象外 (follow-up issue で扱う)

- 「リカロートを非表示」(Hide reposts only) — Block ほど強くなく Mute より緩い独立概念。X 風の UX として将来追加。
- Phase 5 (掲示板) への Block / Mute 反映 — 本 Phase はモデル整備までとし、`apps/boards/views.py` への filter 適用は別 issue (boards-spec §1 の TODO 参照)。
- Reaction (`apps/reactions`) への Block 適用 — 既存実装が `is_blocked_relationship` を呼んでいない場合は別 issue。
- 自動スパム検知 (SPEC §14.5) — 別 phase (Bot/Beat 系)。
- Slack/Email による admin 通知 — Phase 9 監視統合と一緒に実装。

### 1.3 設計方針

- **Block は対称・Mute は非対称**: 既存 `apps.common.blocking.is_blocked_relationship(a, b)` が `Q(blocker=a, blockee=b) | Q(blocker=b, blockee=a)` で双方向を見る。Mute は `is_muted_by(viewer, target)` で `Q(muter=viewer, mutee=target)` のみを見る (`apps.common.muting` を新設)。
- **Block / Mute 共存時は Block 優先** (どちらも非表示なので結果は同じだが、UI 表記としては Block を優先)。
- **既存リアクション / Quote / Reply は Block 後も保持** (X 準拠、SPEC §14.2 に明記なしの判断)。新規アクションのみブロック。
- **Block 時に follow 関係は自動解消** (片側のみフォローしていた場合も含めて削除)。これは X 準拠で、ブロック解除後に自動で再フォローはしない。
- **Mute 中の Quote tweet 経由の表示は許容** (B を mute、C が B のツイートを quote → A の TL に C の quote は出る)。X 準拠。
- **target_id は CharField(64)** に統一 (Phase 4A `Notification.target_id` と整合。Tweet/ThreadPost/Article/Message は BigAutoField (int)、User は UUID なので、可変長 string で受ける)。ER.md §2.12 の UUIDField 表記は本 spec で更新する。

---

## 2. データモデル

### 2.1 Block

```python
class Block(models.Model):
    blocker = ForeignKey(User, on_delete=CASCADE, related_name="blocking_set")
    blockee = ForeignKey(User, on_delete=CASCADE, related_name="blocked_by_set")
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["blocker", "blockee"], name="unique_block"),
            CheckConstraint(check=~Q(blocker=F("blockee")), name="no_self_block"),
        ]
        indexes = [
            Index(fields=["blocker"], name="moderation_block_blocker_idx"),
            Index(fields=["blockee"], name="moderation_block_blockee_idx"),
        ]
```

### 2.2 Mute

```python
class Mute(models.Model):
    muter = ForeignKey(User, on_delete=CASCADE, related_name="muting_set")
    mutee = ForeignKey(User, on_delete=CASCADE, related_name="muted_by_set")
    created_at = DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["muter", "mutee"], name="unique_mute"),
            CheckConstraint(check=~Q(muter=F("mutee")), name="no_self_mute"),
        ]
        indexes = [
            Index(fields=["muter"], name="moderation_mute_muter_idx"),
        ]
```

### 2.3 Report (ER.md §2.12 から target_id 型を変更)

```python
class Report(models.Model):
    class Target(TextChoices):
        TWEET = "tweet"
        ARTICLE = "article"
        MESSAGE = "message"
        THREAD_POST = "thread_post"
        USER = "user"

    class Reason(TextChoices):
        SPAM = "spam"
        ABUSE = "abuse"
        COPYRIGHT = "copyright"
        INAPPROPRIATE = "inappropriate"
        OTHER = "other"

    class Status(TextChoices):
        PENDING = "pending"
        RESOLVED = "resolved"
        DISMISSED = "dismissed"

    reporter = ForeignKey(User, on_delete=SET_NULL, null=True, related_name="reports_sent")
    target_type = CharField(max_length=20, choices=Target.choices)
    target_id = CharField(max_length=64)  # ER.md §2.12 の UUIDField から変更 (本 spec §1.3)
    reason = CharField(max_length=20, choices=Reason.choices)
    note = TextField(max_length=1000, blank=True, default="")
    status = CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = DateTimeField(auto_now_add=True)
    resolved_at = DateTimeField(null=True, blank=True)
    resolved_by = ForeignKey(
        User, on_delete=SET_NULL, null=True, blank=True, related_name="reports_resolved"
    )

    class Meta:
        indexes = [
            Index(fields=["status", "-created_at"], name="moderation_report_status_idx"),
            Index(fields=["reporter", "-created_at"], name="moderation_report_reporter_idx"),
            Index(fields=["target_type", "target_id"], name="moderation_report_target_idx"),
        ]
```

---

## 3. 適用ポイント (Block / Mute をどこに反映するか)

| 機能                                                                 | Block (双方向)                                                                         | Mute (`muter→mutee` 一方向)                                                                               |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Home TL (`apps/timeline/services.py`)                                | 既存 lazy-import 活性化 (modelが入ると自動有効)                                        | **新規実装** (`exclude(author__in=Mute.muted_for(viewer))`)                                               |
| User TL (`/u/<handle>` のツイート一覧)                               | 既存 (Block 中はそもそもプロフィール 404 にせず空表示)                                 | 適用しない (本人プロフィールを開けば mute 中でも見える、X 準拠)                                           |
| Reply / Detail (`/tweet/<id>`)                                       | 既存 (Block 中ユーザーの reply は隠す)                                                 | スコープ外 (将来)                                                                                         |
| 検索 (`apps/search`)                                                 | 既存 lazy-import 活性化                                                                | スコープ外 (将来)                                                                                         |
| DM (`apps/dm/services.py::send_message`)                             | 既存 (送信時に 403)                                                                    | スコープ外 (DM は明示的な選択行動なので Mute 適用しない、X 準拠)                                          |
| Follow (`apps/follows/views.py`)                                     | 既存 + Block 作成時に既存 follow を双方向解消                                          | 適用しない                                                                                                |
| Notification (`apps/notifications/services.py::create_notification`) | 既存に追加: actor が recipient を Block していたら skip                                | **新規実装**: recipient が actor を Mute していたら skip (mention/like/repost/reply/quote/follow 全 kind) |
| Reaction                                                             | 既存に追加: Block 関係なら 403 (新規のみ、既存は保持)                                  | スコープ外                                                                                                |
| Repost / Quote                                                       | Block 関係なら 403                                                                     | Mute は適用しない (X 準拠)                                                                                |
| プロフィール閲覧                                                     | Block 中は閲覧可だが「あなたはブロックされています」表示 (将来)、本 Phase は普通に表示 | 適用しない                                                                                                |

---

## 4. API 仕様

### 4.1 エンドポイント一覧

| メソッド | パス                                  | 認証 | throttle    | 説明                           |
| -------- | ------------------------------------- | ---- | ----------- | ------------------------------ |
| `POST`   | `/api/v1/moderation/blocks/`          | 必須 | 30/h        | ユーザーをブロック             |
| `DELETE` | `/api/v1/moderation/blocks/<handle>/` | 必須 | 30/h        | ブロック解除                   |
| `GET`    | `/api/v1/moderation/blocks/`          | 必須 | user (既定) | 自分がブロック中のユーザー一覧 |
| `POST`   | `/api/v1/moderation/mutes/`           | 必須 | 30/h        | ユーザーをミュート             |
| `DELETE` | `/api/v1/moderation/mutes/<handle>/`  | 必須 | 30/h        | ミュート解除                   |
| `GET`    | `/api/v1/moderation/mutes/`           | 必須 | user        | 自分がミュート中のユーザー一覧 |
| `POST`   | `/api/v1/moderation/reports/`         | 必須 | 5/h         | 通報送信                       |

### 4.2 リクエスト / レスポンス

**POST `/api/v1/moderation/blocks/`**

```jsonc
// Request
{ "target_handle": "bob" }

// Response 201
{ "blocker_handle": "alice", "blockee_handle": "bob", "created_at": "..." }
```

副作用:

- `Follow.objects.filter(Q(follower=alice, followee=bob) | Q(follower=bob, followee=alice)).delete()` を同 transaction 内で実行 (双方向自動解消)

**POST `/api/v1/moderation/reports/`**

```jsonc
// Request
{
  "target_type": "tweet",
  "target_id": "12345",
  "reason": "spam",
  "note": "繰り返し同一広告URLを投稿"
}

// Response 201
{ "id": "<uuid>", "status": "pending", "created_at": "..." }
```

`target_type` × `target_id` の存在確認:

- tweet → `Tweet.objects.filter(id=int(target_id), is_deleted=False).exists()`
- article → `Article.objects.filter(id=int(target_id)).exists()` (Phase 6 で実装、本 Phase では skip 可)
- message → `Message.objects.filter(id=int(target_id)).exists()`
- thread_post → `ThreadPost.objects.filter(id=int(target_id)).exists()`
- user → `User.objects.filter(id=target_id, is_active=True).exists()` (UUID)

存在しない場合は **400** (`code="invalid_target"`)。自分自身を対象にしようとした場合も **400** (`code="self_target"`)。

### 4.3 エラー code

| HTTP | code               | 意味                                      |
| ---- | ------------------ | ----------------------------------------- |
| 400  | `self_target`      | 自分自身を Block/Mute/Report しようとした |
| 400  | `invalid_target`   | Report の target が存在しない             |
| 400  | `target_not_found` | Block/Mute の target_handle が存在しない  |
| 404  | (default)          | DELETE 対象の Block/Mute が存在しない     |
| 429  | (default)          | throttle 上限超過                         |

### 4.4 レートリミット

`config/settings/base.py` の `DEFAULT_THROTTLE_RATES` に追加:

```python
"moderation_block": "30/hour",
"moderation_mute": "30/hour",
"moderation_report": "5/hour",
```

---

## 5. UI 仕様

### 5.1 プロフィール kebab メニュー (`/u/<handle>`)

参考: ユーザー提供 Karotter スクリーンショット (リカロート非表示 / ミュート / ブロック / 通報する)

- フォロー / DM ボタンの右隣に ⋯ ボタン (shadcn `DropdownMenu`)
- 自分自身のプロフィールでは表示しない
- メニュー項目:
  - 🔇 ミュート / 🔊 ミュート解除 (Mute 状態で文言切替)
  - 🚫 ブロック / 🚫 ブロック解除 (Block 状態で文言切替、赤文字)
  - 🚩 通報する
- a11y:
  - kebab ボタン: `aria-label="その他のアクション"`、`aria-haspopup="menu"`
  - メニュー: `role="menu"`、各項目 `role="menuitem"`
  - Block / Mute 実行時は `AlertDialog` (`role="alertdialog"`) で確認 → 楽観的 UI 反映 → API 送信

### 5.2 ツイートの kebab (`TweetCard` 既存)

- 既存に「通報」項目を追加 (自分のツイートには出さない、削除のみのまま)
- 「通報」クリックで `ReportDialog` (target_type=`tweet`, target_id=tweet.id)

### 5.3 通報モーダル (`ReportDialog`)

- shadcn `Dialog` (modal=true、`aria-modal`、focus trap、ESC 閉じ)
- 構造:
  - タイトル: 「通報する」
  - サブテキスト: 通報対象 (例: 「@alice のツイート」「@bob のアカウント」)
  - RadioGroup (label: 「理由を選択」):
    - スパム
    - 誹謗中傷
    - 著作権侵害
    - 不適切コンテンツ
    - その他
  - Textarea (label: 「詳細 (任意)」、max 1000 字)
  - 送信ボタン (理由未選択時 `disabled`)、キャンセルボタン
- 送信成功:
  - モーダル閉じる + toast「通報を受け付けました。ご協力ありがとうございます。」
- エラー:
  - 429: モーダル内に「しばらく時間をおいて再度送信してください」
  - 400 (`invalid_target` / `self_target`): モーダル内エラーメッセージ

### 5.4 設定画面

- `/settings/blocks` — ブロック中ユーザー一覧 (avatar / display_name / @handle / 「解除」ボタン)
- `/settings/mutes` — ミュート中ユーザー一覧
- 50 件固定ページサイズ (Phase 後の運用データで判断、本 Phase はページネーションなし)
- 空状態: 「ブロック中のユーザーはいません」/ 「ミュート中のユーザーはいません」

### 5.5 既存ナビへの追加

- `LeftNavbar` SettingsMenu (既存) に項目追加:
  - 「ブロック中のユーザー」 → `/settings/blocks`
  - 「ミュート中のユーザー」 → `/settings/mutes`

---

## 6. アクセシビリティ要件 (WCAG 2.2 AA)

- kebab ボタン: `aria-label`、`aria-expanded`、`aria-haspopup`
- DropdownMenu: shadcn の Radix UI 実装 (focus trap / arrow key navigation 既定)
- ReportDialog: `role="dialog"` `aria-modal="true"` `aria-labelledby` `aria-describedby`
- Block 確認: `role="alertdialog"` (重要なため)
- Block 実行ボタン: 赤文字 + `aria-label="ブロックを確定する"`
- 楽観的 UI 反映時、`aria-live="polite"` で「ブロックしました」「ミュート解除しました」を告知
- フォームエラー: `aria-describedby` でラジオ未選択時のメッセージ参照

---

## 7. セキュリティ

- 自己 Block/Mute/Report の DB 制約 (`CheckConstraint`) + serializer 層検証
- target_id を CharField で受けるため、target_type に応じて backend で型変換 + 存在検証 (SQL injection 経路なし、ただし lookup の前に `int()` が IDスタイルなら成功すること、UUID なら parse 試行)
- Report の note は最大 1000 字 + bleach sanitize (admin で表示時は `mark_safe` を使わない)
- Block 解除後の Replay (古いトークンで Block 中状態を表示してた client が新規アクションを送ってくる) は serializer の DB 取得で検証されるため問題なし
- レートリミットでスパム通報を防止

---

## 8. パフォーマンス

- `Block` / `Mute` の `Index(fields=["blocker"])` / `Index(fields=["muter"])` で TL 側のクエリ高速化
- TL 側の filter は `~Q(author__in=...)` で subquery にせず set を取得後に `not in` で絞る方が早い (既存 `_blocked_user_ids` パターン踏襲)
- Mute は muter 側のみ参照なので Subquery が小さい

---

## 9. テスト戦略

カバレッジ 80%+ 必須。

### 9.1 単体テスト (pytest)

- model 制約 (unique / self prevent / cascade)
- serializer (target 存在検証、self prevent、reason choices)
- helpers (`is_blocked_relationship`, `is_muted_by`)

### 9.2 統合テスト (DRF APIClient)

- 各エンドポイントの 201 / 400 / 404 / 429 分岐
- Block 作成で follow 関係が双方向削除される
- Mute 中の user の tweet が home TL に出ない
- Mute 中の user による mention で通知が作成されない

### 9.3 E2E (Playwright)

[moderation-scenarios.md](./moderation-scenarios.md) と [moderation-e2e-commands.md](./moderation-e2e-commands.md) を参照。

---

## 10. 受け入れ基準 (ROADMAP §Phase 4B 対応)

- [ ] `apps/moderation` の Block / Mute / Report モデル + migration
- [ ] Block / Mute / Report API 動作 (auth / throttle / validation)
- [ ] Block / Mute が TL ・通知に反映 (Block: 双方向、Mute: 一方向)
- [ ] Block 作成で follow 関係が自動解消
- [ ] プロフィール kebab メニュー UI
- [ ] ツイート kebab に通報追加 + 通報モーダル
- [ ] /settings/blocks /settings/mutes ページ
- [ ] admin から Report の status を変更可能
- [ ] Playwright E2E 緑

---

## 11. ER.md §2.12 への変更点

本 spec で確定した変更:

1. `Report.target_id`: `UUIDField` → **`CharField(max_length=64)`**
   - 理由: Tweet/ThreadPost/Article/Message が BigAutoField (int) のため、UUID 限定では受けられない。Phase 4A `Notification.target_id` と整合する string 化方針。
2. `Report.status`: ER.md は `resolved` boolean のみだったが、本 spec では `Status` enum (pending / resolved / dismissed) に拡張。
3. `Block.created_at`: ER.md `TimeStampedModel` 継承を、本 spec では明示的に `auto_now_add` のみ (本プロジェクトでは TimeStampedModel を使っていないため)。
4. Index 追加: `blocker_idx`, `blockee_idx`, `muter_idx`, `report_status_idx` 等。

これらは ER.md 本体には別 PR で反映する (本 spec が正本)。
