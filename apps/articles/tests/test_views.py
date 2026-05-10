"""Tests for articles CRUD views (#526 / Phase 6 P6-03).

docs/issues/phase-6.md P6-03 受け入れ基準:
- anonymous で published 一覧 OK / draft 詳細 404 / 自分の draft は GET OK
- PATCH で status=draft → published に切替時 published_at 自動セット
- slug 衝突は 400
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.articles.models import Article, ArticleStatus, ArticleTag
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


def _published_article(author, **kwargs):
    from django.utils import timezone

    defaults = {
        "title": "Hello",
        "slug": "hello",
        "body_markdown": "# h\n\nbody",
        "status": ArticleStatus.PUBLISHED,
        "published_at": timezone.now(),
    }
    defaults.update(kwargs)
    return Article.objects.create(author=author, **defaults)


def _draft_article(author, **kwargs):
    defaults = {
        "title": "Draft",
        "slug": "draft-1",
        "body_markdown": "wip",
        "status": ArticleStatus.DRAFT,
    }
    defaults.update(kwargs)
    return Article.objects.create(author=author, **defaults)


# ----------------------------------------------------------------------
# 一覧 GET
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_list_published_anonymous() -> None:
    alice = _user("alice")
    _published_article(alice, slug="a", title="A")
    _draft_article(alice, slug="b", title="B")
    client = APIClient()
    resp = client.get(reverse("articles:list-create"))
    assert resp.status_code == 200
    body = resp.json()
    slugs = [a["slug"] for a in body["results"]]
    assert "a" in slugs
    assert "b" not in slugs  # draft は出ない


@pytest.mark.django_db
def test_list_filtered_by_author() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _published_article(alice, slug="a", title="A")
    _published_article(bob, slug="b", title="B")
    client = APIClient()
    resp = client.get(reverse("articles:list-create"), {"author": "alice"})
    assert resp.status_code == 200
    slugs = [a["slug"] for a in resp.json()["results"]]
    assert slugs == ["a"]


@pytest.mark.django_db
def test_list_filtered_by_tag() -> None:
    alice = _user("alice")
    article = _published_article(alice, slug="t1", title="T")
    tag = Tag.all_objects.create(name="django", display_name="Django", is_approved=True)
    ArticleTag.objects.create(article=article, tag=tag)
    _published_article(alice, slug="t2", title="No tag")
    client = APIClient()
    resp = client.get(reverse("articles:list-create"), {"tag": "django"})
    assert resp.status_code == 200
    slugs = [a["slug"] for a in resp.json()["results"]]
    assert "t1" in slugs
    assert "t2" not in slugs


# ----------------------------------------------------------------------
# 詳細 GET
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_detail_published_anonymous() -> None:
    alice = _user("alice")
    _published_article(alice, slug="my-post")
    client = APIClient()
    resp = client.get(reverse("articles:detail", kwargs={"slug": "my-post"}))
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "my-post"
    assert "<h1>" in body["body_html"]


@pytest.mark.django_db
def test_detail_draft_404_for_anonymous() -> None:
    alice = _user("alice")
    _draft_article(alice, slug="secret")
    client = APIClient()
    resp = client.get(reverse("articles:detail", kwargs={"slug": "secret"}))
    assert resp.status_code == 404


@pytest.mark.django_db
def test_detail_draft_404_for_other_user() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _draft_article(alice, slug="secret")
    client = APIClient()
    client.force_authenticate(user=bob)
    resp = client.get(reverse("articles:detail", kwargs={"slug": "secret"}))
    assert resp.status_code == 404


@pytest.mark.django_db
def test_detail_draft_visible_to_author() -> None:
    alice = _user("alice")
    _draft_article(alice, slug="draft1")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.get(reverse("articles:detail", kwargs={"slug": "draft1"}))
    assert resp.status_code == 200


@pytest.mark.django_db
def test_view_count_increment_excludes_author() -> None:
    alice = _user("alice")
    bob = _user("bob")
    article = _published_article(alice, slug="popular")
    client = APIClient()

    # author 自身が見ても view_count は増えない
    client.force_authenticate(user=alice)
    resp = client.get(reverse("articles:detail", kwargs={"slug": "popular"}))
    assert resp.status_code == 200
    article.refresh_from_db()
    assert article.view_count == 0

    # 他人が見ると view_count が +1
    client.force_authenticate(user=bob)
    client.get(reverse("articles:detail", kwargs={"slug": "popular"}))
    article.refresh_from_db()
    assert article.view_count == 1


# ----------------------------------------------------------------------
# 作成 POST
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_create_default_status_is_draft() -> None:
    alice = _user("alice")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.post(
        reverse("articles:list-create"),
        {"title": "New", "body_markdown": "hi", "slug": "new-post"},
        format="json",
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "draft"
    assert body["published_at"] is None


@pytest.mark.django_db
def test_create_published_sets_published_at() -> None:
    alice = _user("alice")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.post(
        reverse("articles:list-create"),
        {
            "title": "Pub",
            "slug": "pub",
            "body_markdown": "hi",
            "status": "published",
        },
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["published_at"] is not None


@pytest.mark.django_db
def test_create_slug_collision_400() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _published_article(alice, slug="taken")
    client = APIClient()
    client.force_authenticate(user=bob)
    resp = client.post(
        reverse("articles:list-create"),
        {"title": "x", "slug": "taken", "body_markdown": "y"},
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_auto_slug_from_title() -> None:
    alice = _user("alice")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.post(
        reverse("articles:list-create"),
        {"title": "Hello World", "body_markdown": "x"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["slug"] == "hello-world"


@pytest.mark.django_db
def test_create_too_many_tags_400() -> None:
    alice = _user("alice")
    client = APIClient()
    client.force_authenticate(user=alice)
    for i in range(6):
        Tag.all_objects.create(name=f"tag{i}", display_name=f"Tag{i}", is_approved=True)
    resp = client.post(
        reverse("articles:list-create"),
        {
            "title": "x",
            "slug": "many-tags",
            "body_markdown": "y",
            "tags": ["tag0", "tag1", "tag2", "tag3", "tag4", "tag5"],
        },
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_unknown_tag_400() -> None:
    alice = _user("alice")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.post(
        reverse("articles:list-create"),
        {
            "title": "x",
            "slug": "x",
            "body_markdown": "y",
            "tags": ["nonexistent"],
        },
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_create_anonymous_403() -> None:
    client = APIClient()
    resp = client.post(
        reverse("articles:list-create"),
        {"title": "x", "slug": "x", "body_markdown": "y"},
        format="json",
    )
    assert resp.status_code in (401, 403)


# ----------------------------------------------------------------------
# 編集 PATCH
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_patch_draft_to_published_sets_published_at() -> None:
    alice = _user("alice")
    article = _draft_article(alice, slug="d1")
    assert article.published_at is None
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.patch(
        reverse("articles:detail", kwargs={"slug": "d1"}),
        {"status": "published"},
        format="json",
    )
    assert resp.status_code == 200
    article.refresh_from_db()
    assert article.status == ArticleStatus.PUBLISHED
    assert article.published_at is not None


@pytest.mark.django_db
def test_patch_other_user_404() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _draft_article(alice, slug="hers")
    client = APIClient()
    client.force_authenticate(user=bob)
    resp = client.patch(
        reverse("articles:detail", kwargs={"slug": "hers"}),
        {"title": "stolen"},
        format="json",
    )
    assert resp.status_code == 404


# ----------------------------------------------------------------------
# 削除 DELETE
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_delete_soft_deletes() -> None:
    alice = _user("alice")
    article = _published_article(alice, slug="goodbye")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.delete(reverse("articles:detail", kwargs={"slug": "goodbye"}))
    assert resp.status_code == 204
    article.refresh_from_db()
    assert article.is_deleted is True
    # 一覧に出ない
    list_resp = client.get(reverse("articles:list-create"))
    slugs = [a["slug"] for a in list_resp.json()["results"]]
    assert "goodbye" not in slugs


@pytest.mark.django_db
def test_delete_other_user_404() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _published_article(alice, slug="hers")
    client = APIClient()
    client.force_authenticate(user=bob)
    resp = client.delete(reverse("articles:detail", kwargs={"slug": "hers"}))
    assert resp.status_code == 404


# ----------------------------------------------------------------------
# /articles/me/drafts/
# ----------------------------------------------------------------------


@pytest.mark.django_db
def test_my_drafts_only_self_drafts() -> None:
    alice = _user("alice")
    bob = _user("bob")
    _draft_article(alice, slug="alice-draft")
    _draft_article(bob, slug="bob-draft")
    _published_article(alice, slug="alice-pub")
    client = APIClient()
    client.force_authenticate(user=alice)
    resp = client.get(reverse("articles:my-drafts"))
    assert resp.status_code == 200
    slugs = [a["slug"] for a in resp.json()["results"]]
    assert slugs == ["alice-draft"]


@pytest.mark.django_db
def test_my_drafts_anonymous_403() -> None:
    client = APIClient()
    resp = client.get(reverse("articles:my-drafts"))
    assert resp.status_code in (401, 403)
