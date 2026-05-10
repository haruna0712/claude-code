"""Tests for apps/articles model layer (#524 / Phase 6 P6-01).

docs/issues/phase-6.md P6-01 受け入れ基準:
- model 作成 / status 切替 / unique 制約 / 論理削除
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

from apps.articles.models import (
    Article,
    ArticleComment,
    ArticleImage,
    ArticleLike,
    ArticleStatus,
    ArticleTag,
)
from apps.tags.models import Tag

User = get_user_model()


def _user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _article(author, **kwargs):
    defaults = {
        "slug": "hello-world",
        "title": "Hello",
        "body_markdown": "# Hello\n\nworld",
    }
    defaults.update(kwargs)
    return Article.objects.create(author=author, **defaults)


# ----------------------------------------------------------------------
# Article
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_default_status_is_draft() -> None:
    user = _user("alice")
    article = _article(user)
    assert article.status == ArticleStatus.DRAFT
    assert article.published_at is None
    assert article.is_deleted is False


@pytest.mark.django_db
def test_article_status_can_be_published() -> None:
    user = _user("alice")
    article = _article(user, status=ArticleStatus.PUBLISHED)
    assert article.status == "published"


@pytest.mark.django_db
def test_article_unique_per_author_slug() -> None:
    user = _user("alice")
    _article(user, slug="dup")
    with pytest.raises(IntegrityError):
        _article(user, slug="dup", title="Other")


@pytest.mark.django_db
def test_article_other_author_can_use_same_slug() -> None:
    a = _user("alice")
    b = _user("bob")
    _article(a, slug="hello")
    _article(b, slug="hello")
    assert Article.objects.filter(slug="hello").count() == 2


@pytest.mark.django_db
def test_article_soft_delete_sets_flag_and_timestamp() -> None:
    user = _user("alice")
    article = _article(user)
    article.soft_delete()
    article.refresh_from_db()
    assert article.is_deleted is True
    assert article.deleted_at is not None
    # idempotent
    deleted_at = article.deleted_at
    article.soft_delete()
    article.refresh_from_db()
    assert article.deleted_at == deleted_at


# ----------------------------------------------------------------------
# ArticleTag
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_tag_unique_per_article_tag() -> None:
    user = _user("alice")
    article = _article(user)
    tag = Tag.all_objects.create(name="django", display_name="Django", is_approved=True)
    ArticleTag.objects.create(article=article, tag=tag, sort_order=0)
    with pytest.raises(IntegrityError):
        ArticleTag.objects.create(article=article, tag=tag, sort_order=1)


# ----------------------------------------------------------------------
# ArticleImage
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_image_can_have_null_article_for_draft_upload() -> None:
    user = _user("alice")
    img = ArticleImage.objects.create(
        article=None,
        uploader=user,
        s3_key="articles/foo/bar.png",
        url="https://cdn.example.com/articles/foo/bar.png",
        width=800,
        height=600,
        size=12345,
    )
    assert img.article_id is None


# ----------------------------------------------------------------------
# ArticleLike
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_like_unique_per_user_article() -> None:
    user = _user("alice")
    other = _user("bob")
    article = _article(user)
    ArticleLike.objects.create(article=article, user=other)
    with pytest.raises(IntegrityError):
        ArticleLike.objects.create(article=article, user=other)


@pytest.mark.django_db
def test_article_like_cascades_on_article_delete() -> None:
    user = _user("alice")
    other = _user("bob")
    article = _article(user)
    ArticleLike.objects.create(article=article, user=other)
    article.delete()
    assert ArticleLike.objects.count() == 0


# ----------------------------------------------------------------------
# ArticleComment
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_article_comment_top_level_and_reply() -> None:
    user = _user("alice")
    other = _user("bob")
    article = _article(user)
    top = ArticleComment.objects.create(article=article, author=other, body="hi")
    reply = ArticleComment.objects.create(article=article, author=user, body="thanks", parent=top)
    assert reply.parent_id == top.id


@pytest.mark.django_db
def test_article_comment_soft_delete() -> None:
    user = _user("alice")
    article = _article(user)
    comment = ArticleComment.objects.create(article=article, author=user, body="x")
    comment.soft_delete()
    comment.refresh_from_db()
    assert comment.is_deleted is True
    assert comment.deleted_at is not None
