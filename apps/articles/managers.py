"""Custom managers for the articles app (#524 / Phase 6 P6-01).

`Article` / `ArticleComment` は論理削除 (`is_deleted`) を採用するため、
既定の `objects` は削除済みを除外する。`apps.tweets.managers` と同じ
パターン (TweetManager) に合わせる。

- `Article.objects.all()` は削除済みを含まない
- 削除済みを含めたい場合は `Article.all_objects` か
  `Article.objects.all_with_deleted()` を使う

python-reviewer #541 CRITICAL: 既定 manager で削除済みを leak しないため必須。
"""

from __future__ import annotations

from django.db import models


class _SoftDeleteQuerySet(models.QuerySet):
    """is_deleted ベースのチェーン可能な alive/dead を提供する mixin."""

    def alive(self) -> _SoftDeleteQuerySet:
        return self.filter(is_deleted=False)

    def dead(self) -> _SoftDeleteQuerySet:
        return self.filter(is_deleted=True)


class ArticleQuerySet(_SoftDeleteQuerySet):
    """Article 用 QuerySet."""


class ArticleManager(models.Manager.from_queryset(ArticleQuerySet)):
    """既定で is_deleted=False の Article のみを返す."""

    def get_queryset(self) -> ArticleQuerySet:  # type: ignore[override]
        return super().get_queryset().filter(is_deleted=False)

    def all_with_deleted(self) -> ArticleQuerySet:
        """削除済みを含むすべての Article を返す."""

        return super().get_queryset()


class ArticleCommentQuerySet(_SoftDeleteQuerySet):
    """ArticleComment 用 QuerySet."""


class ArticleCommentManager(models.Manager.from_queryset(ArticleCommentQuerySet)):
    """既定で is_deleted=False のコメントのみを返す."""

    def get_queryset(self) -> ArticleCommentQuerySet:  # type: ignore[override]
        return super().get_queryset().filter(is_deleted=False)

    def all_with_deleted(self) -> ArticleCommentQuerySet:
        return super().get_queryset()
