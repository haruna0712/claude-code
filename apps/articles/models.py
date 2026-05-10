"""Models for the articles app (#524 / Phase 6 P6-01).

docs/issues/phase-6.md P6-01 + SPEC §12 に従って実装。

- Article: 公開/下書きの 2 段階、論理削除、(author, slug) で一意、partial index で
  公開済 TL を高速化。
- ArticleTag: through model。既存 apps.tags.Tag を流用、最大 5 個 (P6-10 で view 層
  validate)。
- ArticleImage: 記事内画像 (S3 + CloudFront)。記事 publish 時に GitHub `images/<slug>/`
  にもコピーされる (P6-09)。
- ArticleLike: 1 ユーザー 1 記事 1 件。
- ArticleComment: Markdown 対応、1 段ネストまで (parent FK self、孫ネストは view 層
  validate)、論理削除。
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.articles.managers import ArticleCommentManager, ArticleManager


class ArticleStatus(models.TextChoices):
    """記事のステータス. SPEC §12.1 通り 2 段階のみ (限定公開は MVP 除外)."""

    DRAFT = "draft", "下書き"
    PUBLISHED = "published", "公開済"


class Article(models.Model):
    """ユーザーが書く Zenn ライク Markdown 記事."""

    # UUID 主キー: GitHub 連携やプリサインド URL の path に出ても enumeration されにくい。
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # python-reviewer #541 HIGH: アカウント削除時に CASCADE で記事も hard-delete
    # される。soft_delete の意図と整合しないため、Phase 6 完了後に SET_NULL に
    # 切替 + pre_delete signal で先に soft_delete する Issue を別途起票予定。
    # MVP では tweets / boards と同じ CASCADE で進める (整合性優先)。
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="articles",
    )
    # SPEC §12.2 の URL は `/articles/<slug>` (グローバルに一意)。
    # python-reviewer #541 CRITICAL: (author, slug) では URL ambiguous なので
    # globally unique に変更。Zenn は `/<author>/articles/<slug>` 形式だが、
    # 本プロジェクトの SPEC §12.2 は `/articles/<slug>` を採用する。
    # SlugField で path-traversal / XSS の素材になる non-ASCII を 拒否。
    slug = models.SlugField(max_length=120, unique=True)
    # SPEC §12.1 1〜120 字 (タイトル)
    title = models.CharField(max_length=120)
    body_markdown = models.TextField()
    # P6-02 の render_article_markdown() で sanitize 済 HTML を cache。
    # NEVER assign body_html directly from user input — 必ずサニタイザ経由。
    body_html = models.TextField(blank=True)
    status = models.CharField(
        max_length=16,
        choices=ArticleStatus.choices,
        default=ArticleStatus.DRAFT,
    )
    # 公開時刻。draft → published 切替で自動セット (services / signals 層で実装)。
    published_at = models.DateTimeField(null=True, blank=True)
    # python-reviewer #541 HIGH: race を避けるため必ず F("view_count") + 1 で
    # `Article.objects.filter(pk=...).update(...)` で更新する。直接 += は禁止。
    view_count = models.PositiveIntegerField(default=0)
    # 論理削除 (apps/tweets / apps/boards と整合)。slug を欠番にしないため。
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ArticleManager()
    # admin / 監査用に削除済も見られる all_objects を別 manager として提供
    # (apps/tweets/managers.py と同じ pattern)。複数 Manager 宣言のため
    # DJ012 (field は manager より前であるべき) を無効化する。
    all_objects = models.Manager()  # noqa: DJ012

    class Meta:
        # slug は SlugField(unique=True) で globally unique。`(author, slug)` は
        # 重複 unique となるので削除。
        indexes = [
            # 公開済 TL の主要 query を partial index で高速化。
            models.Index(
                fields=["-published_at"],
                name="articles_published_idx",
                condition=models.Q(status="published", is_deleted=False),
            ),
            # 自分の draft 一覧用。
            models.Index(fields=["author", "-updated_at"]),
        ]
        ordering = ["-published_at", "-created_at"]

    def __str__(self) -> str:
        return f"{self.title} (@{self.author_id} / {self.slug})"

    def save(self, *args, **kwargs):
        """body_html を body_markdown から自動生成 (P6-02 サニタイザ).

        P6-01 review HIGH-1: body_html を view 層から直接代入する footgun を
        防ぐため、save() 時に必ずサニタイザ経由で再生成する。
        """

        from apps.articles.services.markdown import render_article_markdown

        self.body_html = render_article_markdown(self.body_markdown or "")
        super().save(*args, **kwargs)

    def soft_delete(self) -> None:
        """論理削除 (apps/tweets と同じ pattern).

        database-reviewer #541 HIGH: 2 並行 call で both が guard を抜けないよう、
        UPDATE を SQL レベルで原子実行する (filter + update)。冪等。
        """

        now = timezone.now()
        updated = (
            type(self)
            .all_objects.filter(pk=self.pk, is_deleted=False)
            .update(is_deleted=True, deleted_at=now)
        )
        if updated:
            self.is_deleted = True
            self.deleted_at = now


class ArticleTag(models.Model):
    """Article × Tag の through model. 既存 apps.tags.Tag を流用 (SPEC §12.1)."""

    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="article_tags",
    )
    tag = models.ForeignKey(
        "tags.Tag",
        on_delete=models.CASCADE,
        related_name="article_tags",
    )
    # 表示順 (UI 上のチップ順序)。ユーザー指定順を保持する。
    sort_order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["article", "tag"],
                name="uniq_article_tag",
            ),
        ]
        indexes = [
            models.Index(fields=["tag", "-created_at"]),
        ]
        ordering = ["sort_order", "created_at"]

    def __str__(self) -> str:
        return f"{self.article_id} → tag:{self.tag_id}"


class ArticleImage(models.Model):
    """記事内に貼られる画像 (S3 + CloudFront 配信)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # 編集中は article=None で先に upload、確定時に article を埋める運用 (P6-04)。
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="images",
        null=True,
        blank=True,
    )
    uploader = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="article_images",
    )
    # S3 key (例: "articles/<user_uuid>/<image_uuid>.png")
    # python-reviewer #541 MEDIUM: 同一 key の重複 row を防ぐため unique=True。
    s3_key = models.CharField(max_length=512, unique=True)
    # CloudFront URL。配信は CDN 経由のみ (security: bucket 直アクセス禁止)。
    url = models.URLField(max_length=1024)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    # bytes; SPEC では 5MB 上限を view 層 validate (P6-04)。
    size = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["article", "-created_at"]),
            models.Index(fields=["uploader", "-created_at"]),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"image:{self.id} ({self.s3_key})"


class ArticleLike(models.Model):
    """記事いいね (1 ユーザー 1 記事 1 件)."""

    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="likes",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="article_likes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["article", "user"],
                name="uniq_article_like",
            ),
        ]
        indexes = [
            models.Index(fields=["article", "-created_at"]),
            models.Index(fields=["user", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"@{self.user_id} likes {self.article_id}"


class ArticleComment(models.Model):
    """記事コメント (Markdown 対応、1 段ネストまで、論理削除)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    article = models.ForeignKey(
        Article,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="article_comments",
    )
    # 1 段ネストのみ (view 層で「parent.parent_id is None」を強制、grandchild 禁止)
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        related_name="replies",
        null=True,
        blank=True,
    )
    body = models.TextField()
    # P6-02 で render 済 HTML を cache。
    body_html = models.TextField(blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ArticleCommentManager()
    # admin / 監査用 (apps/tweets/managers.py と同じ pattern)。
    all_objects = models.Manager()  # noqa: DJ012

    class Meta:
        indexes = [
            models.Index(fields=["article", "-created_at"]),
            models.Index(fields=["parent", "-created_at"]),
        ]
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"comment:{self.id} on {self.article_id}"

    def save(self, *args, **kwargs):
        """body_html を body から自動生成 (P6-02 サニタイザ)."""

        from apps.articles.services.markdown import render_article_markdown

        self.body_html = render_article_markdown(self.body or "")
        super().save(*args, **kwargs)

    def soft_delete(self) -> None:
        """論理削除 (Article と同じく atomic UPDATE、冪等)."""

        now = timezone.now()
        updated = (
            type(self)
            .all_objects.filter(pk=self.pk, is_deleted=False)
            .update(is_deleted=True, deleted_at=now)
        )
        if updated:
            self.is_deleted = True
            self.deleted_at = now
