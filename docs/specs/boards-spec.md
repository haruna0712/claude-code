# 掲示板 (Boards) — 詳細仕様

> Version: 0.1 (Phase 5 着手時、2026-05-06)
> 関連: [SPEC.md §11](../SPEC.md), [ER.md §2.15](../ER.md), [ROADMAP.md Phase 5](../ROADMAP.md), [boards-scenarios.md](./boards-scenarios.md), [boards-e2e-commands.md](./boards-e2e-commands.md)
>
> SPEC.md §11 を実装視点に正規化したもの。曖昧だった「990 / 1000 レス」境界、削除挙動、メンション抽出、画像アップロード方式、レートリミットを確定する。

---

## 1. 概要

```
板 (Board)             ← 管理者のみ作成・削除 (Django admin)
  └ スレッド (Thread)   ← ログインユーザー作成可、最大 1000 レス
      └ レス (ThreadPost) ← ログインユーザー投稿、本人 + admin のみ削除
          └ 画像 (ThreadPostImage)  ← 1 レス最大 4 枚 / 各 5MB
```

- **未ログイン**: 一覧 / 詳細を閲覧可。投稿 UI は CTA に置換。
- **ログイン**: スレ作成・レス投稿・本人レス削除可。
- **管理者 (`is_staff=True`)**: 板 CRUD（admin のみ）、スレ削除、任意レス削除。
- **モデレーション (Block/Mute)**: Phase 4B が未完了のため MVP では非連動 (TODO: Phase 4B 完了後に横断 issue で TL/検索と同時に反映)。
- **掲示板内検索**: MVP では実装しない (SPEC §11.4)。

---

## 2. データモデル

ER.md §2.15 を踏襲しつつ、本仕様で以下を **追加** または **明示** する。

### 2.1 Board (変更なし)

```python
class Board(TimeStampedModel):
    name = CharField(max_length=50, unique=True)
    slug = SlugField(max_length=50, unique=True)
    description = TextField(max_length=500, blank=True)
    order = PositiveSmallIntegerField(default=0)
    color = CharField(max_length=7, default="#3b82f6")  # hex
```

**追加制約**:

- `color` は `^#[0-9a-fA-F]{6}$` の正規表現バリデーションを serializer 層に置く（実装者注: ER.md は CharField のみで CHECK 制約は付けない）。
- `slug` は `[a-z0-9-]{1,50}` を強制（DRF SlugField デフォルト）。

### 2.2 Thread (追加: `is_deleted`)

```python
class Thread(TimeStampedModel):
    board = ForeignKey(Board, on_delete=CASCADE, related_name="threads")
    author = ForeignKey(User, on_delete=SET_NULL, null=True, related_name="threads")
    title = CharField(max_length=100)
    post_count = PositiveIntegerField(default=0)
    last_post_at = DateTimeField(db_index=True)  # 1 レス目作成時に created_at と同値で初期化
    locked = BooleanField(default=False)         # 1000 レス到達 or 管理者操作で True
    is_deleted = BooleanField(default=False)     # 管理者の論理削除 (本仕様で追加)
    deleted_at = DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            Index(fields=["board", "-last_post_at"]),
            # is_deleted=False で絞った partial index
            Index(fields=["board", "-last_post_at"], condition=Q(is_deleted=False),
                  name="boards_thread_active_tl_idx"),
        ]
```

### 2.3 ThreadPost (追加: `is_deleted`/`deleted_at`)

```python
class ThreadPost(TimeStampedModel):
    thread = ForeignKey(Thread, on_delete=CASCADE, related_name="posts")
    author = ForeignKey(User, on_delete=SET_NULL, null=True, related_name="thread_posts")
    number = PositiveIntegerField()              # 1..1000、欠番は出さない（削除時も保持）
    body = TextField(max_length=5000)            # SPEC §11.2: Markdown / コードブロック対応
    is_deleted = BooleanField(default=False)     # 投稿者本人 or admin が削除
    deleted_at = DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            UniqueConstraint(fields=["thread", "number"], name="unique_thread_post_number"),
        ]
        indexes = [
            Index(fields=["thread", "number"]),
        ]
```

**論理削除の理由**:

- ER.md には未定義だが、`number` を欠番にしない設計 ＋ tweets が soft-delete を採用している運用ポリシーと整合。
- API 出力: `is_deleted=True` の post は `body` を空、`images` を空、`author` を null 化して返す。フロントエンドは「このレスは削除されました」と灰色プレースホルダで表示。
- `post_count` は減らさない（1000 上限の意味を保つ）。

### 2.4 ThreadPostImage (変更なし)

```python
class ThreadPostImage(TimeStampedModel):
    post = ForeignKey(ThreadPost, on_delete=CASCADE, related_name="images")
    image_url = URLField(max_length=512, validators=[URLValidator(schemes=["https"])])
    width = PositiveIntegerField()
    height = PositiveIntegerField()
    order = PositiveSmallIntegerField(default=0, validators=[MaxValueValidator(3)])

    class Meta:
        unique_together = [("post", "order")]
```

- `image_url` は S3 上の https URL（presigned PUT で先にアップロード済みのものを参照）。
- 1 レス最大 4 枚（`order` は 0..3）。

---

## 3. API

### 3.1 一覧・詳細（匿名 OK）

| メソッド | パス                                    | 用途                                                                            |
| -------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/boards/`                       | 板一覧（`order` 昇順）                                                          |
| `GET`    | `/api/v1/boards/<slug>/`                | 板詳細（メタのみ）                                                              |
| `GET`    | `/api/v1/boards/<slug>/threads/?page=N` | 板内スレ一覧（`last_post_at` desc、`is_deleted=False`）                         |
| `GET`    | `/api/v1/threads/<id>/`                 | スレ詳細メタ（タイトル、`post_count`、`locked` など、posts は別エンドポイント） |
| `GET`    | `/api/v1/threads/<id>/posts/?page=N`    | レス一覧（`number` 昇順、ページサイズ 50、削除済も含むがフィールドは redact）   |

- すべて `permission_classes = [AllowAny]`。
- ページネーション: `PageNumberPagination`（`page_size=30` for threads, `page_size=50` for posts）。
- N+1 防止: スレ一覧で `select_related("author", "board")`、posts で `select_related("author")` + `prefetch_related("images")`。

### 3.2 書き込み系（ログイン必須）

| メソッド | パス                                            | 用途                                   |
| -------- | ----------------------------------------------- | -------------------------------------- |
| `POST`   | `/api/v1/boards/<slug>/threads/`                | 新規スレッド作成（1 レス目を同時投入） |
| `POST`   | `/api/v1/threads/<id>/posts/`                   | レス追加                               |
| `DELETE` | `/api/v1/posts/<id>/`                           | レス削除（論理削除、本人 + admin）     |
| `POST`   | `/api/v1/boards/thread-post-images/upload-url/` | 画像 S3 presigned PUT URL 発行         |

**全エンドポイント共通**:

- `permission_classes = [IsAuthenticated]`
- DRF Throttle: 後述 §3.5 のレートリミット
- レスポンスエンベロープは既存 API と揃え、エラー時は `{"detail": "...", "code": "..."}` 形式

### 3.3 リクエスト / レスポンス例

**POST `/api/v1/boards/<slug>/threads/`**

```jsonc
// Request
{
  "title": "Django + Next.js 開発スレ",
  "first_post_body": "立てました。情報共有しましょう。",
  "first_post_images": [
    {"image_url": "https://s3.../thread_posts/2026/05/abc.png", "width": 800, "height": 600, "order": 0}
  ]
}

// Response 201
{
  "id": 42,
  "board": "django",
  "title": "Django + Next.js 開発スレ",
  "author": {"handle": "alice", "display_name": "Alice"},
  "post_count": 1,
  "last_post_at": "2026-05-06T09:00:00Z",
  "locked": false,
  "first_post": { /* ThreadPost serialized */ }
}
```

**POST `/api/v1/threads/<id>/posts/`**

```jsonc
// Request
{
  "body": "@bob ここ参考になります",
  "images": []
}

// Response 201
{
  "id": 9001,
  "thread": 42,
  "number": 7,
  "author": {"handle": "alice", "display_name": "Alice"},
  "body": "@bob ここ参考になります",
  "images": [],
  "created_at": "2026-05-06T09:05:00Z",
  "is_deleted": false,
  "thread_state": {
    "post_count": 7,
    "locked": false,
    "approaching_limit": false  // post_count >= 990 で true
  }
}
```

**423 Locked** (1000 レス到達後の追加投稿):

```json
{
	"detail": "このスレッドはレス上限 (1000) に達しています。新しいスレッドを立ててください。",
	"code": "thread_locked"
}
```

### 3.4 画像アップロードフロー

1. フロント: `POST /api/v1/boards/thread-post-images/upload-url/`（body: `{content_type, content_length}`）
2. サーバー: 既存 `apps.users.s3_presign.generate_presigned_upload_url` パターンを **boards 用にラップ** して発行。
   - prefix: `thread_posts/<yyyy>/<mm>/<uuid>.<ext>`
   - 有効期間: 15 分
   - allowed content-type: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
   - max size: 5MB
3. フロント: presigned URL に直接 PUT、その後 `image_url` をスレ作成 / レス作成 API に含めて送信。
4. サーバー: `image_url` のホスト名が S3 バケット (`settings.AWS_STORAGE_BUCKET_NAME`) であることを serializer で検証。

### 3.5 レートリミット

DRF Throttle scope を追加:

| Scope                  | レート                         | 対象エンドポイント                            |
| ---------------------- | ------------------------------ | --------------------------------------------- |
| `boards_thread_create` | `12/hour`（5 分に 1 件相当）   | `POST /boards/<slug>/threads/`                |
| `boards_post_create`   | `120/hour`（30 秒に 1 件相当） | `POST /threads/<id>/posts/`                   |
| `boards_image_presign` | `30/hour`                      | `POST /boards/thread-post-images/upload-url/` |

`config/settings/base.py` の `DEFAULT_THROTTLE_RATES` に追加。

---

## 4. ロジック詳細

### 4.1 スレ作成（1 レス目を同 transaction で）

```python
@transaction.atomic
def create_thread_with_first_post(board, author, title, body, images):
    now = timezone.now()
    thread = Thread.objects.create(
        board=board, author=author, title=title,
        post_count=0, last_post_at=now, locked=False,
    )
    first_post = append_post(thread, author, body, images)
    return thread, first_post
```

### 4.2 レス追加（採番・lock 判定）

```python
class ThreadLocked(Exception): ...

THREAD_POST_HARD_LIMIT = 1000
THREAD_POST_WARNING_LIMIT = 990

@transaction.atomic
def append_post(thread, author, body, images=()):
    # 行ロックで採番レースを排除
    locked_thread = Thread.objects.select_for_update().get(pk=thread.pk)
    if locked_thread.locked:
        raise ThreadLocked()
    if locked_thread.post_count >= THREAD_POST_HARD_LIMIT:
        # safety net: locked=False のまま 1000 に達した場合もガード
        Thread.objects.filter(pk=thread.pk).update(locked=True)
        raise ThreadLocked()

    next_number = locked_thread.post_count + 1
    post = ThreadPost.objects.create(
        thread=locked_thread, author=author, number=next_number, body=body,
    )
    for idx, img in enumerate(images[:4]):
        ThreadPostImage.objects.create(post=post, order=idx, **img)

    new_count = next_number
    new_locked = (new_count >= THREAD_POST_HARD_LIMIT)
    Thread.objects.filter(pk=thread.pk).update(
        post_count=new_count,
        last_post_at=timezone.now(),
        locked=new_locked,
    )
    # メンション抽出 + 通知 (transaction.on_commit で発火)
    transaction.on_commit(lambda: emit_mention_notifications(post))
    return post
```

### 4.3 メンション抽出

- 正規表現: `r"@([A-Za-z0-9_]{3,30})"`（既存 `@handle` バリデーションと同形）。
- 抽出後 set 化（重複除去）。
- 自分自身は通知しない。
- `User.objects.filter(handle__in=...)` で実在ユーザーのみに絞る。
- 上限: 1 レスあたり最大 10 ユーザー（既存通知層の `MAX_MENTION_NOTIFY` を流用）。
- `apps.notifications.services.create_notification(kind=NotificationKind.MENTION, target_type="thread_post", target_id=post.id, ...)` を呼ぶ。
- NotificationSetting で `mention=False` のユーザーへは通知層側で skip される。

### 4.4 削除挙動

| 操作            | 権限                       | 実装                                                         |
| --------------- | -------------------------- | ------------------------------------------------------------ |
| Board 削除      | admin のみ（Django admin） | 物理削除、CASCADE で配下スレ・レスも削除                     |
| Thread 削除     | admin のみ                 | 論理削除（`is_deleted=True`、TL から除外）。作成者本人は不可 |
| ThreadPost 削除 | 投稿者本人 + admin         | 論理削除（`is_deleted=True`、`body`/images redact）          |

### 4.5 990 / 1000 境界の UI ヒント

API レスポンスに `thread_state.approaching_limit` を含める:

- `post_count >= 990` で `true`
- `post_count >= 1000` で `locked=true` も同時に `true`

フロントは:

- `approaching_limit=true` で「残り N レス。新スレッドの作成を検討してください」バナー。
- `locked=true` で投稿フォームを「次スレを立てる」CTA に差し替え。

---

## 5. URL ルーティング

### 5.1 バックエンド

`config/urls.py` 既存:

```python
path("api/v1/boards/", include("apps.boards.urls"))
```

`apps/boards/urls.py` 新規:

```python
urlpatterns = [
    path("", BoardListView.as_view()),                       # GET 一覧
    path("thread-post-images/upload-url/", ImagePresignView.as_view()),
    path("<slug:slug>/", BoardDetailView.as_view()),         # GET 詳細
    path("<slug:slug>/threads/", BoardThreadListView.as_view()),  # GET / POST
]
# Threads / Posts は別マウント
```

`config/urls.py` に **新規追加**:

```python
path("api/v1/threads/", include("apps.boards.urls_threads"))   # threads/<id>/, threads/<id>/posts/
path("api/v1/posts/", include("apps.boards.urls_posts"))        # posts/<id>/
```

### 5.2 フロントエンド

| パス             | 認証 | 内容             |
| ---------------- | ---- | ---------------- |
| `/boards`        | 任意 | 板一覧           |
| `/boards/<slug>` | 任意 | 板詳細・スレ一覧 |
| `/threads/<id>`  | 任意 | スレ詳細         |

すべて Next.js App Router。SSR で初期データを取得（CloudFront にキャッシュ可能）。

---

## 6. アクセシビリティ要件 (WCAG 2.2 AA)

- 板一覧 / スレ一覧 / レス一覧は `<ul>` / `<ol>` または `role="list"` で構造化。
- レス一覧は `<ol>`（番号付きリスト）として実装し、`number` を `<li>` 内で視覚的に強調しつつ `aria-label="レス N 番"` を付ける。
- 投稿フォームの送信中表示は `aria-busy="true"` + `role="status"` でスクリーンリーダーに通知。
- 990 接近バナーは `role="status"`（控えめな告知）、1000 ロックは `role="alert"`（重要）。
- 削除済みレス: `<li aria-label="削除されたレス">`、本文は `<em>このレスは削除されました</em>`。
- リンクとボタンを混同しない（板カード全体は `<a>`、ロックされた投稿フォームは `<button>` ではなく無効化テキスト）。

---

## 7. セキュリティ

- XSS: 既存 tweets と同じ Markdown サニタイズ (`bleach` + `markdown2`) を適用。コードブロックは Shiki でレンダリング。
- CSRF: 既存 djoser / DRF SessionAuthentication ＋ HttpOnly Cookie パターンを踏襲（`csrftoken` cookie を bootstrap）。
- 画像アップロード: presigned URL で 5MB 上限、Content-Type 制限。サーバー側でも `image_url` のホストを検証。
- レートリミット: §3.5 のスコープを必須化。
- Mass-assignment: serializer の `fields` をホワイトリスト指定。`is_staff` / `is_deleted` は read-only。

---

## 8. パフォーマンス

- スレ一覧: partial index `boards_thread_active_tl_idx` で `is_deleted=False AND board=?` を高速化。
- レス一覧: ページサイズ 50 で固定、`number` 昇順は既存 unique index で高速。
- カウンタ denormalize: `Thread.post_count` / `last_post_at` は append_post 内で原子的に更新。
- TL キャッシュ: MVP では Redis キャッシュなし（既存 ホーム TL のような fan-out-on-read は不要）。

---

## 9. テスト戦略

カバレッジ 80%+ を必須。

### 9.1 単体テスト（pytest）

- Board / Thread / ThreadPost の制約（unique number、constraint check）。
- `append_post`: 採番レース、1000 上限、990 警告フラグ、画像枚数上限。
- `create_thread_with_first_post`: 1 レス目同時生成、トランザクションロールバック。
- メンション抽出: 重複除去、自己メンション除外、存在しない handle 無視。
- 論理削除 redaction: API シリアライザレベルで body/images が空になる。

### 9.2 統合テスト（DRF APIClient）

- 匿名 GET (一覧 / 詳細 / posts) が 200。
- 匿名 POST が 401。
- 投稿者以外の DELETE が 403。
- ロック後の POST が 423。
- レートリミット閾値超で 429。
- 画像 5 枚目で 400。
- メンション抽出 → Notification 1 件作成。

### 9.3 E2E テスト（Playwright）

[boards-scenarios.md](./boards-scenarios.md) と [boards-e2e-commands.md](./boards-e2e-commands.md) を参照。

---

## 10. 受け入れ基準（ROADMAP §Phase 5 対応）

- [ ] `apps/boards` のモデル・migration が走る
- [ ] 板 CRUD が Django admin から可能
- [ ] スレ・レス API が動作（ログイン必須）
- [ ] `/boards`, `/boards/<slug>`, `/threads/<id>` が未ログイン閲覧可
- [ ] 1000 レスで自動 lock、990 で警告バナー
- [ ] 管理者のみスレ削除、投稿者本人 + admin がレス削除
- [ ] `@handle` メンションで通知が届く（Phase 4A 連動）
- [ ] Playwright E2E spec が緑

---

## 11. MVP 対象外（Phase 6+ で再検討）

- 板内検索（SPEC §11.4）
- Block / Mute 連動（Phase 4B 完了後の横断 issue）
- スレッドの「次スレへ」自動リンク（手動でユーザーが新スレを立てる前提）
- スレッドへのリアクション / お気に入り
- レスへのコードハイライト言語自動判定（既存 Shiki にお任せ）
