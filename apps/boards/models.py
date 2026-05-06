"""Models for the boards app (Phase 5 / Issue #425).

SPEC §11 + ER.md §2.15 に従い、以下 4 モデルを提供する:

- ``Board``: 板。Django admin のみで CRUD。
- ``Thread``: スレッド。ログインユーザー作成可、最大 1000 レス。
- ``ThreadPost``: レス。ログインユーザー投稿、本人 + admin 削除可。
- ``ThreadPostImage``: 1 レスにつき最大 4 枚 (各 5MB)。

論理削除 (`is_deleted` / `deleted_at`) は Thread / ThreadPost の両方に持たせる
(boards-spec.md §2 の追加制約)。

集計フィールド (`Thread.post_count`, `last_post_at`, `locked`) は
``apps.boards.services.append_post`` で原子的に更新する。
"""

from __future__ import annotations

from django.conf import settings
from django.core.validators import MaxValueValidator, URLValidator
from django.db import models
from django.db.models import Q


class Board(models.Model):
    """掲示板の最上位カテゴリ。Django admin のみで CRUD する。"""

    name = models.CharField(max_length=50, unique=True)
    slug = models.SlugField(max_length=50, unique=True)
    description = models.TextField(max_length=500, blank=True, default="")
    order = models.PositiveSmallIntegerField(default=0)
    # hex color (`#rrggbb`)。serializer 層で正規表現検証する。
    color = models.CharField(max_length=7, default="#3b82f6")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]

    def __str__(self) -> str:  # pragma: no cover
        return f"Board(slug={self.slug!r})"


class Thread(models.Model):
    """掲示板のスレッド。

    - 作成は認証必須。
    - 1 スレッドあたり最大 1000 レス (services.append_post で enforce)。
    - 削除は admin のみ (論理削除)。作成者本人は不可 (SPEC §11.2)。
    """

    board = models.ForeignKey(Board, on_delete=models.CASCADE, related_name="threads")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="threads",
    )
    title = models.CharField(max_length=100)

    post_count = models.PositiveIntegerField(default=0)
    last_post_at = models.DateTimeField(db_index=True)
    locked = models.BooleanField(default=False)

    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_post_at"]
        indexes = [
            models.Index(fields=["board", "-last_post_at"]),
            models.Index(
                fields=["board", "-last_post_at"],
                condition=Q(is_deleted=False),
                name="boards_thread_active_tl_idx",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Thread(id={self.pk}, board={self.board_id}, title={self.title!r})"


class ThreadPost(models.Model):
    """スレッドへのレス。

    - ``number`` は 1..1000 で thread 内ユニーク (削除時も欠番にしない)。
    - 削除は本人 + admin のみ。論理削除 (`is_deleted=True`) で
      レンダリング時に「このレスは削除されました」プレースホルダ化する。
    """

    thread = models.ForeignKey(Thread, on_delete=models.CASCADE, related_name="posts")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="thread_posts",
    )
    number = models.PositiveIntegerField()
    body = models.TextField(max_length=5000, blank=True, default="")

    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["thread", "number"]
        constraints = [
            models.UniqueConstraint(fields=["thread", "number"], name="unique_thread_post_number"),
        ]
        indexes = [
            models.Index(fields=["thread", "number"]),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"ThreadPost(id={self.pk}, thread={self.thread_id}, number={self.number})"


class ThreadPostImage(models.Model):
    """ThreadPost に添付される画像 (最大 4 枚 / order 0..3)."""

    post = models.ForeignKey(ThreadPost, on_delete=models.CASCADE, related_name="images")
    image_url = models.URLField(
        max_length=512,
        validators=[URLValidator(schemes=["https"])],
    )
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    order = models.PositiveSmallIntegerField(
        default=0,
        validators=[MaxValueValidator(3)],
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["post", "order"], name="unique_thread_post_image_order"
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"ThreadPostImage(post={self.post_id}, order={self.order})"

    def save(self, *args, **kwargs) -> None:
        """枚数 / order の制約を save 経路で必ず適用する (defense in depth)."""
        self.full_clean()
        super().save(*args, **kwargs)

    def clean(self) -> None:
        from django.core.exceptions import ValidationError

        super().clean()
        if self.post_id is None:
            return
        qs = ThreadPostImage.objects.filter(post_id=self.post_id)
        if self.pk is not None:
            qs = qs.exclude(pk=self.pk)
        if qs.count() >= 4:
            raise ValidationError("1 つのレスに添付できる画像は最大 4 枚です。")
