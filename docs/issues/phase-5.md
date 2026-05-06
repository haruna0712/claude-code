# Phase 5: 掲示板 — Issue 一覧ドラフト

> Phase 目標: 5ch 風掲示板の最小構成 (板 / スレッド / レス) を実装し、未ログイン閲覧 / ログイン投稿 / 1000 レス上限 / `@handle` メンション通知 / 画像 4 枚添付まで stg で動作確認する
> マイルストーン: `Phase 5: 掲示板`
> バージョン: **v1**
> 関連: [SPEC.md §11](../SPEC.md), [ER.md §2.15](../ER.md), [boards-spec.md](../specs/boards-spec.md), [boards-scenarios.md](../specs/boards-scenarios.md), [boards-e2e-commands.md](../specs/boards-e2e-commands.md)
>
> 設計判断:
>
> - **論理削除**: `Thread.is_deleted` / `ThreadPost.is_deleted` を追加（ER.md は CASCADE 物理削除前提だったが、`number` を欠番にしないため + tweets と整合させるため、本仕様で論理削除に変更）
> - **画像アップロード**: 既存 `apps/users/s3_presign.py` パターンを流用し、`POST /api/v1/boards/thread-post-images/upload-url/` で presigned PUT URL 発行
> - **メンション通知**: Phase 4A で実装済みの `apps.notifications.services.create_notification(kind=MENTION, target_type="thread_post", target_id=...)` を呼ぶ
> - **モデレーション**: Phase 4B 未完了のため Block/Mute は MVP 非連動。完了後に横断 issue で TL/検索/DM と同時に反映
> - **板 CRUD**: Django admin のみ。Web API では公開しない

## 依存グラフ

```
Phase 4A 完了 (Notification 発火基盤あり)
  │
  ├──▶ P5-01 apps/boards モデル + admin (Board, Thread, ThreadPost, ThreadPostImage)
  │     │
  │     ├──▶ P5-02 集計サービス: append_post / create_thread_with_first_post (採番 / lock / 990警告)
  │     │     │
  │     │     ├──▶ P5-03 Board / Thread / Post 一覧・詳細 API (匿名 OK)
  │     │     ├──▶ P5-04 Thread 作成 API + 1 レス目同時生成 (auth)
  │     │     ├──▶ P5-05 Post 作成 API (auth, 1000 lock, RL, image 0-4)
  │     │     ├──▶ P5-06 Post 削除 API (本人 + admin, 論理削除)
  │     │     └──▶ P5-08 メンション抽出 + 通知発火 (Phase 4A 連動)
  │     │
  │     └──▶ P5-07 画像 presigned URL 発行 API + serializer 検証
  │
  ├──▶ P5-09 /boards 板一覧 + /boards/<slug> 板詳細・スレ一覧 (frontend)
  │
  ├──▶ P5-10 /threads/<id> スレ詳細 (境界 UI / mention link / 削除済表示)
  │
  ├──▶ P5-11 投稿フォーム (新規スレ / レス) + 未ログイン CTA (frontend)
  │
  └──▶ P5-12 Playwright E2E + a11y / security レビュー + docs 更新
```

---

## P5-01. [feature][backend] apps/boards モデル + Django admin (4 モデル)

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: Phase 4A 完了 (#412)

### 目的

ER §2.15 のスキーマに `is_deleted` / `deleted_at` (Thread / ThreadPost) を追加して実装。Phase 5 全体の土台。

### 作業内容

- [ ] `apps/boards/models.py` に `Board` / `Thread` / `ThreadPost` / `ThreadPostImage` を実装
- [ ] `Board.color` の正規表現バリデーション (`^#[0-9a-fA-F]{6}$`) は serializer 層に置く
- [ ] `Thread.is_deleted` / `deleted_at` を追加（partial index `boards_thread_active_tl_idx` も）
- [ ] `ThreadPost.is_deleted` / `deleted_at` を追加
- [ ] `ThreadPostImage.image_url` は https 限定 URLValidator
- [ ] Django admin 登録（Board は CRUD 可、Thread/Post は read + 削除のみ）
- [ ] migration 作成 + `python manage.py migrate` 確認
- [ ] tests/test_models.py: 制約 (unique number, is_deleted default False, color validator) 検証

### 受け入れ基準

- [ ] migration が冪等に走る
- [ ] admin で Board CRUD 可
- [ ] `Thread.locked` default False、`is_deleted` default False
- [ ] `ThreadPost.number` 一意制約 (per thread)
- [ ] tests/test_models.py で 12+ ケース合格

---

## P5-02. [feature][backend] スレ集計サービス (採番 / lock 遷移 / 990 警告)

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-01

### 目的

`append_post(thread, author, body, images)` と `create_thread_with_first_post(...)` を `apps/boards/services.py` に実装。`select_for_update` で採番レースを排除、`post_count == 1000` で `locked=True`。

### 作業内容

- [ ] `apps/boards/services.py` 新規
- [ ] `class ThreadLocked(Exception)` 定義
- [ ] `append_post`:
  - `select_for_update().get(pk=thread.pk)`
  - `locked or post_count >= 1000` で `ThreadLocked`
  - `next_number = post_count + 1`
  - `Thread.objects.filter(pk=...).update(post_count=next_number, last_post_at=now, locked=(next_number>=1000))`
  - `transaction.on_commit(lambda: emit_mention_notifications(post))`
- [ ] `create_thread_with_first_post`: 1 transaction で Thread + 1 レス目を作成
- [ ] tests/test_services.py: 採番レース (`pytest --reruns 0`)、1000 上限、990 フラグ、画像枚数

### 受け入れ基準

- [ ] 100 並列投稿でも `number` 重複なし
- [ ] 1001 件目で `ThreadLocked`
- [ ] `last_post_at` 単調増加

---

## P5-03. [feature][backend] Board / Thread / Post 一覧・詳細 API (匿名 OK)

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: S
- **Depends on**: P5-01

### 目的

未ログインで閲覧可能な GET 系エンドポイント群。

### 作業内容

- [ ] `BoardSerializer` / `ThreadSerializer` / `ThreadPostSerializer` 実装。`is_deleted=True` の post は body / images / author を redact
- [ ] `BoardListView` (`GET /api/v1/boards/`)
- [ ] `BoardDetailView` (`GET /api/v1/boards/<slug>/`)
- [ ] `BoardThreadListView` (`GET /api/v1/boards/<slug>/threads/?page=N`)
- [ ] `ThreadDetailView` (`GET /api/v1/threads/<id>/`)
- [ ] `ThreadPostListView` (`GET /api/v1/threads/<id>/posts/?page=N`)
- [ ] `permission_classes = [AllowAny]`
- [ ] N+1 防止: select_related / prefetch_related
- [ ] tests/test_views_read.py: 匿名 200、削除済 redact、ページネーション

### 受け入れ基準

- [ ] 未認証でも 200
- [ ] N+1 なし (django-debug-toolbar 確認)
- [ ] OpenAPI schema 反映

---

## P5-04. [feature][backend] Thread 作成 API + 1 レス目自動生成

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: S
- **Depends on**: P5-02

### 目的

`POST /api/v1/boards/<slug>/threads/`（auth 必須）。

### 作業内容

- [ ] `ThreadCreateSerializer`: `title` (max 100), `first_post_body` (max 5000), `first_post_images` (0..4)
- [ ] `BoardThreadListView.post`: ThrottleScope `boards_thread_create`
- [ ] レスポンスに作成された thread + first_post を含める
- [ ] tests/test_views_thread_create.py

### 受け入れ基準

- [ ] 未ログインで 401
- [ ] title 空で 400
- [ ] first_post_body 空で 400
- [ ] 5 分以内 2 件目で 429

---

## P5-05. [feature][backend] ThreadPost 作成 API (1000 lock / RL / 画像 0-4)

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-02, P5-07, P5-08

### 目的

`POST /api/v1/threads/<id>/posts/`（auth 必須）。

### 作業内容

- [ ] `ThreadPostCreateSerializer`: `body` (max 5000), `images` (0..4)
- [ ] `ThreadPostCreateView`: ThrottleScope `boards_post_create`
- [ ] `ThreadLocked` を 423 にマップ
- [ ] レスポンスに `thread_state.{post_count, locked, approaching_limit}` を含める
- [ ] tests/test_views_post_create.py

### 受け入れ基準

- [ ] 1000 件目で次回投稿が 423
- [ ] 989→990 で `approaching_limit=true`
- [ ] 画像 5 枚で 400
- [ ] 30 秒以内 2 件目で 429

---

## P5-06. [feature][backend] ThreadPost 削除 API (本人 + admin, 論理削除)

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:medium`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: S
- **Depends on**: P5-01

### 目的

`DELETE /api/v1/posts/<id>/`。投稿者本人または `is_staff=True` のみ可。論理削除。

### 作業内容

- [ ] `ThreadPostDeleteView`
- [ ] permission: `IsAuthorOrAdmin`
- [ ] `is_deleted=True`, `deleted_at=now` で更新（`post_count` は変更しない）
- [ ] tests/test_views_post_delete.py: 他人 403、本人 204、admin 204

### 受け入れ基準

- [ ] 他人で 403
- [ ] 削除済 post は GET で body 空・images 空
- [ ] `post_count` 不変

---

## P5-07. [feature][backend] 画像 presigned URL 発行 + serializer 検証

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:medium`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-01

### 目的

`POST /api/v1/boards/thread-post-images/upload-url/`。既存 `apps/users/s3_presign.py` パターンを流用。

### 作業内容

- [ ] `apps/boards/s3_presign.py` 新規（or `apps/users/s3_presign` を一般化して reuse）
- [ ] prefix: `thread_posts/<yyyy>/<mm>/<uuid>.<ext>`
- [ ] allowed: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- [ ] max size: 5MB（超過で 400 + `code="image_too_large"`）
- [ ] ThrottleScope `boards_image_presign`
- [ ] serializer で `image_url` のホスト名が `settings.AWS_STORAGE_BUCKET_NAME` であることを検証
- [ ] tests/test_views_image.py

### 受け入れ基準

- [ ] 5MB 超で 400
- [ ] 非画像 MIME で 400
- [ ] 未ログインで 401
- [ ] presigned URL は 15 分有効

---

## P5-08. [feature][backend] @handle メンション抽出 + 通知発火

- **Labels**: `type:feature`, `layer:backend`, `area:boards`, `priority:medium`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: S
- **Depends on**: P5-05, Phase 4A 完了

### 目的

ThreadPost 作成時に `@handle` を抽出し、Phase 4A の通知を発火。

### 作業内容

- [ ] `apps/boards/mentions.py`: `extract_mentions(body) -> list[str]`
- [ ] `emit_mention_notifications(post)`: 重複除去・自己除外・存在チェック・上限 10 ユーザー
- [ ] `apps.notifications.services.create_notification(kind=MENTION, target_type="thread_post", target_id=post.id, ...)` を呼ぶ
- [ ] tests/test_mentions.py: 重複・自己メンション・存在しない handle・上限 10

### 受け入れ基準

- [ ] 同一 body で重複 handle → 通知 1 件
- [ ] 自己メンションで通知 0 件
- [ ] NotificationSetting で `mention=False` のユーザーは skip

---

## P5-09. [feature][frontend] /boards 板一覧 + /boards/<slug> 板詳細・スレ一覧

- **Labels**: `type:feature`, `layer:frontend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-03

### 目的

Next.js App Router で SSR、未ログイン閲覧可。

### 作業内容

- [ ] `client/src/app/boards/page.tsx`
- [ ] `client/src/app/boards/[slug]/page.tsx`
- [ ] OpenAPI 型を再生成 (`npm run openapi`)
- [ ] 板カード: `color` を accent
- [ ] スレ一覧は `last_post_at` desc、ページネーション
- [ ] 未ログインなら投稿 CTA は「ログインして投稿する」
- [ ] tests (RTL): boards page render、未ログイン CTA 表示

### 受け入れ基準

- [ ] 未ログインで閲覧可能
- [ ] 板アイコン色適用
- [ ] a11y: nav landmark + heading 階層

---

## P5-10. [feature][frontend] /threads/<id> スレ詳細 (境界 UI / mention / 削除済)

- **Labels**: `type:feature`, `layer:frontend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: L
- **Depends on**: P5-03, P5-05, P5-06

### 目的

スレ詳細ページ。境界 (990/1000) UI / mention link / 削除済プレースホルダ。

### 作業内容

- [ ] `client/src/app/threads/[id]/page.tsx`
- [ ] レス一覧: `<ol>`、ページサイズ 50、deep-link `?p=3`
- [ ] 990↑ で `role="status"` バナー
- [ ] 1000 で投稿フォーム → 「次スレを立てる」CTA
- [ ] 削除済レス: `<em>このレスは削除されました</em>`
- [ ] mention は `/u/<handle>` への Link
- [ ] Markdown / コードブロックは tweets と同じレンダラを共通化
- [ ] tests (RTL): 境界の UI 切替、削除済表示、mention リンク

### 受け入れ基準

- [ ] 989/990/1000 の各境界で UI 切替
- [ ] 削除済 post は body 非表示
- [ ] mention link 動作

---

## P5-11. [feature][frontend] 投稿フォーム + 未ログイン CTA

- **Labels**: `type:feature`, `layer:frontend`, `area:boards`, `priority:high`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-04, P5-05, P5-07

### 目的

新規スレ作成フォーム / レス投稿フォーム。

### 作業内容

- [ ] `BoardThreadComposer.tsx` (新規スレ用)
- [ ] `ThreadPostComposer.tsx` (レス用)
- [ ] 画像 D&D + プレビュー + 4 枚上限 UI
- [ ] presigned URL に直接 PUT してから `image_url` を本体 API に送信
- [ ] `isSubmitting` 中 `aria-busy=true` + ボタン disabled
- [ ] 429 / 423 / 400 のエラー表示

### 受け入れ基準

- [ ] 未ログイン CTA
- [ ] 画像 5 枚目選択時 UI で拒否
- [ ] 送信中ボタン disable
- [ ] 送信成功で楽観的 UI 更新

---

## P5-12. [test][boards] Playwright E2E + a11y/security レビュー + docs 更新

- **Labels**: `type:feature`, `layer:frontend`, `area:boards`, `priority:medium`
- **Milestone**: `Phase 5: 掲示板`
- **Estimate**: M
- **Depends on**: P5-09, P5-10, P5-11

### 目的

shape: `client/e2e/boards-scenarios.spec.ts` を書き、boards-scenarios.md S-01〜S-20 をカバー。

### 作業内容

- [ ] `client/e2e/boards-scenarios.spec.ts` 作成
- [ ] golden path (S-01〜S-05, S-08): 匿名閲覧 → ログイン → スレ作成 → レス → mention 通知
- [ ] 境界 (S-06, S-07): seed 投入 + 990/1000 UI
- [ ] 削除 (S-09〜S-11)
- [ ] レートリミット (S-13, S-14) は `--grep` で分離
- [ ] a11y: `<ol>` / `role="status"` / `role="alert"` / `aria-busy`
- [ ] ROADMAP.md / SPEC.md / db-schema.md 更新

### 受け入れ基準

- [ ] Playwright 緑 (chromium / firefox)
- [ ] a11y 重大指摘 0
- [ ] security 重大指摘 0
- [ ] docs 反映
