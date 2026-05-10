# Phase 6: 記事 (Zenn ライク) — Issue 一覧ドラフト

> Phase 目標: アプリ内 Markdown エディタ + 公開/下書き記事 + 未ログイン閲覧 + GitHub 片方向 push + 公開時の自動ツイート (📄 マーク) を stg で動作確認する
> マイルストーン: `Phase 6: 記事機能（GitHub 片方向 push のみ）`
> バージョン: **v1**
> 関連: [SPEC.md §12](../SPEC.md), [ROADMAP.md Phase 6](../ROADMAP.md), 参考: [haruna0712/chatapp `app/posts` + `app/github_sync`](https://github.com/haruna0712/chatapp)
>
> 設計判断:
>
> - **論理削除**: `Article.is_deleted` / `deleted_at` を採用 (slug を欠番にしない、tweets/threads と整合)
> - **ステータス**: `draft` / `published` の 2 段階のみ (SPEC §12.1、限定公開は MVP 除外)
> - **画像アップロード**: 既存 `apps/users/s3_presign.py` パターンを流用、`POST /api/v1/articles/images/upload-url/` で presigned PUT URL 発行
> - **Markdown レンダリング**: 既存 `apps/tweets` の `render_markdown` をベースに `bleach` ホワイトリスト + `pygments` シンタックスハイライト追加
> - **GitHub 連携**: `PyGithub` を使った片方向 push のみ (chatapp `app/github_sync/services.py:create_or_update_file` を踏襲)。OAuth は GitHub OAuth App (`public_repo` scope)、token は `cryptography.fernet` で AES 暗号化保存。pull / Webhook は Phase 11 以降
> - **自動ツイート**: 公開 (`status=published`) 切替時に `tweet.type=from_article` で自動投稿 (Phase 2 既存の `Tweet` を再利用)。設定 (`UserProfile.auto_tweet_on_publish: bool`) で OFF 可能
> - **slug**: ユーザー入力可、未指定なら `slugify(title)` で自動生成。同一 user 内で unique
> - **タグ**: 既存 `apps/tags` の `Tag` マスタを流用、最大 5 個 (SPEC §12.1)
> - **OGP / JSON-LD**: 詳細ページ Server Component で `<head>` に Article schema 出力、SEO 強化

---

## 依存グラフ

```
Phase 4A 完了 (Notification 発火、Tweet 既存)
  │
  ├──▶ P6-01 apps/articles モデル + admin (Article, ArticleTag, ArticleImage, ArticleLike, ArticleComment)
  │     │
  │     ├──▶ P6-02 Markdown→HTML サービス (bleach + pygments + sanitize)
  │     │     │
  │     │     ├──▶ P6-03 Article CRUD API (draft/publish, list/detail, ownership)
  │     │     │     │
  │     │     │     ├──▶ P6-04 ArticleImage 画像 presigned URL + confirm API
  │     │     │     ├──▶ P6-05 ArticleLike API (toggle, idempotent)
  │     │     │     ├──▶ P6-06 ArticleComment API (1 段ネスト、論理削除、@handle 通知)
  │     │     │     └──▶ P6-07 公開時の自動ツイート (tweet.type=from_article、UserProfile.auto_tweet_on_publish)
  │     │     │
  │     │     └──▶ P6-08 GitHub OAuth + token 暗号化保存 (apps/github_sync 新設)
  │     │           │
  │     │           └──▶ P6-09 Article 公開時 GitHub push サービス (PyGithub、Front Matter MD + 画像)
  │     │
  │     └──▶ P6-10 タグ最大 5 個 + Tag マスタ流用
  │
  ├──▶ P6-11 frontend: 記事一覧 /articles (Server Component、未ログイン閲覧可)
  │
  ├──▶ P6-12 frontend: 記事詳細 /articles/<slug> (OGP / JSON-LD、未ログイン閲覧可)
  │
  ├──▶ P6-13 frontend: 記事作成・編集 /articles/new + /articles/<slug>/edit (Markdown エディタ、プレビュー、画像 D&D)
  │
  ├──▶ P6-14 frontend: いいね + コメント UI
  │
  ├──▶ P6-15 frontend: GitHub 連携設定 /settings/github (連携 ON/OFF + リポジトリ選択)
  │
  ├──▶ P6-16 frontend: TweetCard に 📄 マーク (type=from_article)
  │
  └──▶ P6-17 Playwright E2E + 全レビュー + ROADMAP 反映
```

---

## P6-01. [feature][backend] apps/articles モデル + Django admin

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:high`
- **Milestone**: `Phase 6: 記事機能（GitHub 片方向 push のみ）`
- **Estimate**: M
- **Depends on**: Phase 4A 完了 (#412)

### 目的

SPEC §12 の記事機能の土台となる 5 モデル + admin を作る。

### 作業内容

- [ ] `apps/articles/models.py`:
  - `Article`: id (UUID 推奨)、author (FK User)、slug (CharField, unique together with author)、title (max=120)、body_markdown (TextField)、body_html (TextField、レンダリング後 cache)、status (CharField, choices=draft/published)、published_at (DateTimeField, null)、view_count (PositiveIntegerField)、is_deleted (BooleanField)、deleted_at (DateTimeField, null)、created_at / updated_at
  - `ArticleTag`: through model (article FK, tag FK, sort_order) — 既存 `apps/tags.Tag` を再利用
  - `ArticleImage`: article FK、s3_key (CharField)、url (CharField, CloudFront URL)、width / height (PositiveIntegerField)、size (PositiveIntegerField)、created_at
  - `ArticleLike`: article FK + user FK + created_at、`unique_together (article, user)`
  - `ArticleComment`: article FK、author FK、body (TextField)、parent FK self (null=True for 1 段ネスト)、is_deleted、created_at / updated_at
- [ ] migrations + admin 登録
- [ ] partial index: `articles_published_idx (status='published', is_deleted=False, -published_at)` で TL / 一覧 query 高速化
- [ ] CONSTRAINT: `(author, slug)` unique together、`title` 1〜120 字、`body_markdown` 1〜100000 字

### 受け入れ基準

- [ ] `python manage.py makemigrations articles --check` が通る
- [ ] admin で 5 モデルが表示・編集可能
- [ ] pytest: model 作成 / status 切替 / unique 制約 / 論理削除

---

## P6-02. [feature][backend] Markdown → HTML サニタイズサービス

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:high`
- **Estimate**: S
- **Depends on**: P6-01

### 目的

XSS を確実に防ぎつつ、コードブロックのシンタックスハイライト + 画像表示まで対応した Markdown レンダラを作る。

### 作業内容

- [ ] 依存追加: `markdown`, `bleach`, `pygments` (`requirements/base.txt`)
- [ ] `apps/articles/services/markdown.py`:
  - `render_article_markdown(text: str) -> str` を export
  - `markdown` で Markdown→HTML、`pygments` で fenced code block ハイライト、`bleach.clean` でホワイトリスト sanitize (許可タグ: h1〜h6、p、a、strong、em、code、pre、ul、ol、li、img、blockquote、hr、br、table 系)
  - `<a>` には `rel="noopener noreferrer"` を強制付与
  - `<img>` の `src` は **CloudFront ドメインまたは記事内 ArticleImage.url のみ許可** (任意外部画像は記事 spec で議論)
- [ ] **XSS ペイロードテストセット**: OWASP XSS Filter Evasion Cheat Sheet から 30+ ケース pytest 化

### 受け入れ基準

- [ ] pytest: `<script>` / `javascript:` / `onerror=` / `<iframe>` 等が全て除去される
- [ ] fenced code block (`\`\`\`python ... \`\`\``) が `<pre><code class="language-python">` でハイライト出力
- [ ] 通常の Markdown (h2、リスト、リンク、画像、表) が崩れず出力
- [ ] `Article.save()` 時に `body_html = render_article_markdown(body_markdown)` を自動実行

---

## P6-03. [feature][backend] Article CRUD API (draft/publish, list/detail)

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:high`
- **Estimate**: M
- **Depends on**: P6-01, P6-02

### 目的

記事の作成・編集・公開・削除と、未ログインも含めた一覧 / 詳細閲覧を提供する。

### 作業内容

- [ ] `GET    /api/v1/articles/` 公開記事一覧 (cursor pagination、フィルタ: `?author=<handle>`, `?tag=<slug>`、`?status=published` のみ匿名 OK)
- [ ] `GET    /api/v1/articles/<slug>/` 詳細 (匿名 OK、ただし draft は本人のみ → 他人は 404 隠蔽)
- [ ] `POST   /api/v1/articles/` 作成 (auth、status=draft 既定、tags 0〜5)
- [ ] `PATCH  /api/v1/articles/<slug>/` 編集 (本人のみ、title/body/tags/status/slug)
- [ ] `DELETE /api/v1/articles/<slug>/` 論理削除 (本人 + admin)
- [ ] `GET    /api/v1/articles/me/drafts/` 自分の下書き一覧 (auth)
- [ ] permissions: `IsAuthorOrReadOnly`、draft は本人のみ
- [ ] rate limit: `scope=article_write` 30/hour
- [ ] view_count は GET 詳細で +1 (本人除外、簡易 `F('view_count')+1`)

### 受け入れ基準

- [ ] pytest: anonymous で published 一覧 OK / draft 詳細 404 / 自分の draft は GET OK
- [ ] PATCH で status=draft → published に切替時 published_at 自動セット
- [ ] slug 衝突は (author, slug) で 400 / 自動 suffix `-2` 付与は出さない (Issue にする)
- [ ] OpenAPI schema に出力される

---

## P6-04. [feature][backend] ArticleImage 画像 presigned URL + confirm API

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:medium`
- **Estimate**: S
- **Depends on**: P6-01

### 目的

記事編集中に画像を D&D / paste で S3 直 PUT し、確定時に `ArticleImage` レコード化する。

### 作業内容

- [ ] `POST /api/v1/articles/images/upload-url/` { content_type, size } → presigned PUT URL + s3_key (auth、`apps/users/s3_presign.py` 流用)
- [ ] `POST /api/v1/articles/images/confirm/` { s3_key, width, height } → ArticleImage 作成 + CloudFront URL を返す (auth)
- [ ] 画像種類: `image/png|jpeg|webp|gif`、size <= 5MB
- [ ] storage: `articles/<user_uuid>/<uuid>.<ext>` (Phase 6 では article_id をまだ知らないので user_uuid)、Article 公開時に GitHub 連携で `images/<slug>/` へコピー (P6-09)
- [ ] rate limit: `scope=article_image_upload` 50/hour

### 受け入れ基準

- [ ] pytest: 画像 PUT 成功 → confirm → ArticleImage 作成
- [ ] 5MB 超 / wrong content-type は 400
- [ ] frontend は CloudFront URL を Markdown 内 `![](<url>)` に挿入

---

## P6-05. [feature][backend] ArticleLike API (toggle, idempotent)

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:medium`
- **Estimate**: XS
- **Depends on**: P6-01

### 目的

記事いいね (1 ユーザー 1 件) を実装。Phase 4A の `notifications` と連動して `article_like` 通知を発火。

### 作業内容

- [ ] `POST   /api/v1/articles/<slug>/like/` 追加 (idempotent: 既存は 200、新規 201)
- [ ] `DELETE /api/v1/articles/<slug>/like/` 削除 (なくても 204)
- [ ] `GET    /api/v1/articles/<slug>/like-status/` { liked: bool, like_count: int } (auth optional)
- [ ] 通知: `create_notification(kind=ARTICLE_LIKE, target_type='article', target_id=...)` (Phase 4A 連動)

### 受け入れ基準

- [ ] pytest: idempotent / 削除後 like_count 整合 / 通知発火 / 自分自身への like は通知無し

---

## P6-06. [feature][backend] ArticleComment API (1 段ネスト、論理削除、@handle 通知)

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:medium`
- **Estimate**: S
- **Depends on**: P6-01, P6-02

### 目的

記事コメント (Markdown 対応、1 段ネスト) + メンション通知。

### 作業内容

- [ ] `GET    /api/v1/articles/<slug>/comments/` 一覧 (cursor pagination、論理削除は tombstone)
- [ ] `POST   /api/v1/articles/<slug>/comments/` 投稿 (auth、parent_id optional)
- [ ] `DELETE /api/v1/comments/<id>/` 削除 (本人 + admin、論理削除)
- [ ] body は P6-02 の `render_article_markdown` でレンダリング、cache
- [ ] @handle メンション抽出 → `create_notification(kind=MENTION, target_type='article_comment', ...)`
- [ ] 記事著者へ `create_notification(kind=ARTICLE_COMMENT, ...)` (本人投稿は除外)
- [ ] rate limit: `scope=article_comment_write` 60/hour

### 受け入れ基準

- [ ] pytest: 1 段ネスト OK / 2 段以上は 400 / 論理削除 + tombstone / メンション通知 / 自著者へ ARTICLE_COMMENT 通知

---

## P6-07. [feature][backend] 公開時の自動ツイート (tweet.type=from_article)

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:medium`
- **Estimate**: S
- **Depends on**: P6-03

### 目的

記事を `published` に切り替えたとき、自動で「タイトル + 冒頭 80 字 + 記事リンク」 ツイートを投稿。著者の `UserProfile.auto_tweet_on_publish` で OFF 可能。

### 作業内容

- [ ] `UserProfile` に `auto_tweet_on_publish: BooleanField(default=True)` フィールド追加 (migration)
- [ ] `apps/articles/services/auto_tweet.py`:
  - `create_from_article_tweet(article)` で `Tweet` 作成 (type=from_article、author=記事 author、body=`<title>\n<冒頭 80 字>...\n<URL>`、article_id を repost_of_article_id 等で紐付け or `Tweet` モデルに `from_article_id` FK 追加)
- [ ] `Article.save()` の post_save signal で status が draft→published に変わったタイミングで実行
- [ ] 重複防止: 1 記事 1 ツイート (`from_article_id` unique)

### 受け入れ基準

- [ ] pytest: published 切替で Tweet 1 件作成、再 publish (戻して再公開) でも 2 件目作らない
- [ ] auto_tweet_on_publish=False で作らない
- [ ] 80 字超過は `…` で truncate

---

## P6-08. [feature][backend] GitHub OAuth + token 暗号化保存 (apps/github_sync 新設)

- **Labels**: `type:feature`, `layer:backend`, `area:github-sync`, `priority:high`
- **Estimate**: M
- **Depends on**: なし (新規 app)

### 目的

ユーザーが GitHub と連携して `public_repo` スコープのアクセストークンを発行し、暗号化して DB 保存。

### 作業内容

- [ ] `apps/github_sync/models.py`: `GitHubAccount` (user FK、github_id、login、access_token_enc (BinaryField)、connected_at)、`GitHubRepository` (account FK、repo_full_name、default_branch、selected: BooleanField)
- [ ] `apps/github_sync/encryption.py`: `cryptography.fernet` を使った encrypt/decrypt、key は `settings.GITHUB_TOKEN_ENCRYPTION_KEY` (env、AWS KMS 由来 base64 32B)
- [ ] OAuth flow:
  - `GET  /api/v1/github/oauth/start/` (auth) → state を Redis に保存して GitHub 認可 URL リダイレクト
  - `GET  /api/v1/github/oauth/callback/` → code → token、暗号化保存
- [ ] `GET  /api/v1/github/repos/` 連携リポジトリ一覧 (PyGithub 経由)
- [ ] `POST /api/v1/github/repos/select/` { repo_full_name } 公開先リポジトリ選択
- [ ] `DELETE /api/v1/github/oauth/` 連携解除 (token 削除)

### 受け入れ基準

- [ ] pytest: OAuth callback で token 暗号化保存、復号後 PyGithub でリポ一覧取得
- [ ] state 検証 (Redis、5min TTL)
- [ ] CSRF: callback は state パラメタで検証

---

## P6-09. [feature][backend] Article 公開時 GitHub push サービス (PyGithub)

- **Labels**: `type:feature`, `layer:backend`, `area:github-sync`, `priority:high`
- **Estimate**: M
- **Depends on**: P6-08, P6-03

### 目的

`Article` を `published` に切り替えたタイミング、または編集後保存タイミングで、選択リポジトリへ Front Matter 付き Markdown + 画像を push する。chatapp `app/github_sync/services.py:GitHubSyncService.create_or_update_file` を参考。

### 作業内容

- [ ] `apps/github_sync/services.py`:
  - `GitHubSyncService(access_token)` クラス
  - `sync_article(article)`: Front Matter (title / emoji / type='tech' / topics=tags / published) + body を `articles/<slug>.md` に push、ArticleImage を `images/<slug>/<key>` に push
  - commit message: `docs: <title> を更新`
  - sha 付きで update / 新規は create_file
- [ ] `Article.save()` の post_save signal、`auto_tweet` と同様に published 切替時に Celery task `sync_article_to_github` を enqueue
- [ ] エラー時は `ArticleSyncLog` (status=success/failed/last_error) に記録、UI で確認可能に
- [ ] frontend `/settings/github` で同期エラーを表示

### 受け入れ基準

- [ ] pytest (mock github): Front Matter + 画像 push が呼ばれる、画像 base64 encoded
- [ ] sha mismatch retry 最大 1 回
- [ ] 失敗時 ArticleSyncLog.status=failed、エラー内容保存

---

## P6-10. [feature][backend] タグ最大 5 個 + Tag マスタ流用

- **Labels**: `type:feature`, `layer:backend`, `area:articles`, `priority:medium`
- **Estimate**: XS
- **Depends on**: P6-01, 既存 `apps/tags`

### 目的

ツイートと共通の Tag マスタを記事にも適用。最大 5 個 (SPEC §12.1)。

### 作業内容

- [ ] `Article` serializer / view で `tags` 配列受付 (slug でも name でも)、5 個超は 400
- [ ] `ArticleTag` through model で順序保持
- [ ] 一覧 `?tag=<slug>` で絞り込み

### 受け入れ基準

- [ ] pytest: 5 個 OK、6 個で 400、不正な slug は 400
- [ ] `?tag=django` で記事絞り込み

---

## P6-11. [feature][frontend] 記事一覧 /articles (Server Component)

- **Labels**: `type:feature`, `layer:frontend`, `area:articles`, `priority:high`
- **Estimate**: M
- **Depends on**: P6-03

### 目的

未ログインも閲覧可能な記事一覧ページ。Zenn 風カード grid。

### 作業内容

- [ ] Next.js App Router `app/(template)/articles/page.tsx` Server Component
- [ ] `ArticleCard` コンポーネント (タイトル、emoji、著者、created_at、tag pills、いいね数、コメント数)
- [ ] cursor pagination + 「もっと見る」 button (Client Component)
- [ ] フィルタ: `?author=<handle>` / `?tag=<slug>`
- [ ] OG image: `/api/og/articles?... ` (Phase 12 で OG 画像生成、本 issue では default で十分)

### 受け入れ基準

- [ ] 未ログインで一覧 + 詳細リンクが見える
- [ ] tsc + lint clean
- [ ] vitest: ArticleCard render

---

## P6-12. [feature][frontend] 記事詳細 /articles/<slug> (OGP / JSON-LD)

- **Labels**: `type:feature`, `layer:frontend`, `area:articles`, `priority:high`
- **Estimate**: M
- **Depends on**: P6-03

### 目的

未ログインで記事を読める。OGP + JSON-LD で SEO 強化。

### 作業内容

- [ ] `app/(template)/articles/[slug]/page.tsx` Server Component
- [ ] `body_html` を表示 (DOMPurify は backend で済んでいるが念のため client-side でも sanitize)
- [ ] `<head>`: `og:title` / `og:description` / `og:image` / Twitter Card
- [ ] JSON-LD: schema.org `Article` (headline, author, datePublished, image)
- [ ] サイドバー: 著者カード + 関連タグ + "もっと読む" (同じ著者の他記事)
- [ ] 「いいね」「コメント」 セクション (P6-14 で実装、本 issue では placeholder)

### 受け入れ基準

- [ ] view-source で og: タグと application/ld+json があることを assert
- [ ] vitest: render、Markdown コードブロックがハイライト表示
- [ ] Lighthouse SEO ≥ 90 (stg で計測、別 issue で改善継続)

---

## P6-13. [feature][frontend] 記事作成・編集 /articles/new + /articles/<slug>/edit (Markdown エディタ + プレビュー + 画像 D&D)

- **Labels**: `type:feature`, `layer:frontend`, `area:articles`, `priority:high`
- **Estimate**: L
- **Depends on**: P6-03, P6-04

### 目的

Zenn 風の Markdown エディタで記事を執筆・公開する画面。

### 作業内容

- [ ] `app/(template)/articles/new/page.tsx` (auth 必須、未ログインは redirect login)
- [ ] `app/(template)/articles/[slug]/edit/page.tsx` (本人のみ)
- [ ] エディタ: 左 textarea + 右プレビュー (split pane)、`@uiw/react-md-editor` または `react-markdown` + 自前プレビュー
- [ ] 画像 D&D / paste: P6-04 の presigned URL → S3 PUT → `![alt](<url>)` を挿入
- [ ] フォーム: title / emoji picker / tags (5 個 max) / status (draft/published 切替)
- [ ] 自動保存: 30 秒ごと PATCH (draft のみ)
- [ ] 「公開」 button: status=published に切替 → 確認 dialog (「自動ツイートします、よろしいですか？」)
- [ ] tags は既存 Tag マスタから autocomplete

### 受け入れ基準

- [ ] vitest: form validation、tag chip 追加・削除
- [ ] stg 実機検証: 記事を新規作成 → 画像 D&D → 公開 → 一覧 + 詳細で確認

---

## P6-14. [feature][frontend] いいね + コメント UI

- **Labels**: `type:feature`, `layer:frontend`, `area:articles`, `priority:medium`
- **Estimate**: M
- **Depends on**: P6-05, P6-06, P6-12

### 目的

記事詳細ページにいいねボタンと コメントスレッド (1 段ネスト)。

### 作業内容

- [ ] `<ArticleLikeButton>` (heart icon、楽観 update、auth 必須は CTA 出す)
- [ ] `<ArticleComments>`: 一覧 + 投稿フォーム (Markdown 対応) + 削除 (本人) + 返信 (1 段)
- [ ] @handle メンション autocomplete (既存 mention picker 流用)

### 受け入れ基準

- [ ] vitest: like toggle、comment 投稿 / 削除
- [ ] 通知が「自分への article_like / article_comment」 で届く (#412 設定タブで ON 確認済前提)

---

## P6-15. [feature][frontend] GitHub 連携設定 /settings/github

- **Labels**: `type:feature`, `layer:frontend`, `area:github-sync`, `priority:medium`
- **Estimate**: S
- **Depends on**: P6-08

### 目的

GitHub OAuth 連携 ON/OFF + 公開先リポジトリ選択 UI。

### 作業内容

- [ ] `/settings/github` ページ
- [ ] 未連携: 「GitHub と連携」 button → P6-08 OAuth start に飛ばす
- [ ] 連携済: アバター + login + 「リポジトリを選択」 select (P6-08 `GET /repos/`)、「連携解除」 button
- [ ] 同期エラー履歴 (P6-09 ArticleSyncLog 最新 10 件)

### 受け入れ基準

- [ ] vitest: 連携状態 / リポジトリ選択 / 解除
- [ ] stg 実機: ハルナさんの GitHub アカウントで OAuth 実機確認

---

## P6-16. [feature][frontend] TweetCard に 📄 マーク (type=from_article)

- **Labels**: `type:feature`, `layer:frontend`, `area:tweets`, `priority:low`
- **Estimate**: XS
- **Depends on**: P6-07

### 目的

記事公開時の自動ツイート (`type=from_article`) に Lucide `FileText` アイコンを著者名右に表示し、click で記事詳細へ遷移。

### 作業内容

- [ ] `TweetCard` で `tweet.type === 'from_article'` のとき著者名横に 📄 アイコン + 記事タイトル link

### 受け入れ基準

- [ ] vitest: type=from_article のとき アイコン表示
- [ ] click で `/articles/<slug>` へ遷移

---

## P6-17. [docs] Phase 6 E2E + 全レビュー + ROADMAP 反映

- **Labels**: `type:docs`, `layer:docs`, `area:articles`, `priority:medium`
- **Estimate**: S
- **Depends on**: P6-01〜P6-16

### 目的

docs/specs/articles-spec.md の「テスト」 章 + Playwright spec + stg 実機踏み + ROADMAP の Phase 6 を ✅ にする。

### 作業内容

- [ ] `client/e2e/articles.spec.ts`:
  - ART-1: 記事を作成 (画像 1 枚 D&D 含む) → published → 一覧 + 詳細で確認 + 自動ツイートが TL に出る
  - ART-2: いいね + コメント (1 段ネスト) を別ユーザー (test3) で実行 → 通知を test2 が受信
  - ART-3: GitHub 連携 ON 状態で publish → repo に push されるか (mock or 実 GitHub アカウント)
- [ ] レビュー: python-reviewer / typescript-reviewer / database-reviewer / security-reviewer / a11y-architect 全部直列
- [ ] `docs/ROADMAP.md` Phase 6 のチェックを ✅ + 関連 PR 紐付け

### 受け入れ基準

- [ ] Playwright MCP / stg で 3 シナリオ全 step 緑
- [ ] レビュー CRITICAL/HIGH 全消し
- [ ] ROADMAP Phase 6 ✅

---

## 着手順序の推奨 (MVP 優先)

ハルナさんが「記事作成機能に手をつけて」と求めているので、**動く MVP を最短で出す**順序:

1. **MVP-of-MVP** (動く記事): P6-01 → P6-02 → P6-03 → P6-11 → P6-12 → P6-13
   - これだけで「記事を書いて、未ログインで読める」 が成立。GitHub 連携と自動ツイートは後回し。
2. **インタラクション**: P6-05 (Like) → P6-06 (Comment) → P6-14 (いいね・コメント UI)
3. **画像**: P6-04 → P6-13 への画像 D&D 統合
4. **GitHub 片方向 push**: P6-08 → P6-09 → P6-15
5. **自動ツイート + 📄**: P6-07 → P6-16
6. **タグ**: P6-10 (P6-13 と並行で)
7. **完了**: P6-17 (E2E + ROADMAP 反映)

---

## 関連リンク

- [SPEC.md §12 記事 (Zenn ライク)](../SPEC.md)
- [ROADMAP.md Phase 6](../ROADMAP.md)
- [haruna0712/chatapp `app/posts`](https://github.com/haruna0712/chatapp/tree/main/app/posts) — 記事 model + view 参考
- [haruna0712/chatapp `app/github_sync`](https://github.com/haruna0712/chatapp/tree/main/app/github_sync) — PyGithub 片方向 push 参考
- 既存 `apps/users/s3_presign.py` — presigned URL パターン
- 既存 `apps/notifications/services.create_notification` — 通知発火
