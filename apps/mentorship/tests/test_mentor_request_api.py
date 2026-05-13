"""Tests for MentorRequest CRUD API (P11-03 / Phase 11 11-A).

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §6.1

検証カテゴリ:
- anon GET (list / detail)
- auth POST (create + tag M2M)
- owner only PATCH / DELETE / close
- non-owner / anon writes は 403 / 401
- list は status=open のみ可視
- detail は MATCHED / CLOSED でも可視 (mentee 戻り動線)
- tag filter
- cursor pagination
- input validation (title / body 長さ、 unknown tag)
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.mentorship.models import MentorRequest
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


def _approved_tag(name: str) -> Tag:
    return Tag.all_objects.create(
        name=name,
        display_name=name.capitalize(),
        is_approved=True,
    )


def _make_request(mentee, **kwargs) -> MentorRequest:
    defaults = {"title": "Django で質問", "body": "DRF の認証で詰まっています"}
    defaults.update(kwargs)
    return MentorRequest.objects.create(mentee=mentee, **defaults)


@pytest.fixture
def alice():
    return _user("alice")


@pytest.fixture
def bob():
    return _user("bob")


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def auth_client(alice):
    c = APIClient()
    c.force_authenticate(user=alice)
    return c


# ---- LIST ----


@pytest.mark.django_db
def test_list_anon_returns_only_open(client, alice):
    _make_request(alice, status=MentorRequest.Status.OPEN, title="open one")
    _make_request(alice, status=MentorRequest.Status.MATCHED, title="matched")
    _make_request(alice, status=MentorRequest.Status.CLOSED, title="closed")
    res = client.get(reverse("mentor-request-list"))
    assert res.status_code == 200
    titles = sorted(r["title"] for r in res.data["results"])
    assert titles == ["open one"]


@pytest.mark.django_db
def test_list_includes_envelope_fields(client, alice):
    req = _make_request(alice)
    res = client.get(reverse("mentor-request-list"))
    assert res.status_code == 200
    first = res.data["results"][0]
    # summary serializer は body を含まない
    assert "body" not in first
    assert first["title"] == req.title
    assert first["mentee"]["handle"] == "alice"


@pytest.mark.django_db
def test_list_tag_filter(client, alice):
    django_tag = _approved_tag("django")
    aws_tag = _approved_tag("aws")
    r1 = _make_request(alice, title="django one")
    r1.target_skill_tags.add(django_tag)
    r2 = _make_request(alice, title="aws one")
    r2.target_skill_tags.add(aws_tag)
    res = client.get(reverse("mentor-request-list"), {"tag": "django"})
    titles = sorted(r["title"] for r in res.data["results"])
    assert titles == ["django one"]


@pytest.mark.django_db
def test_list_cursor_pagination(client, alice):
    for i in range(25):
        _make_request(alice, title=f"req {i}")
    res = client.get(reverse("mentor-request-list"))
    assert res.status_code == 200
    assert len(res.data["results"]) == 20  # page_size
    assert res.data["next"] is not None


# ---- DETAIL ----


@pytest.mark.django_db
def test_detail_anon_can_view_open(client, alice):
    req = _make_request(alice)
    res = client.get(reverse("mentor-request-detail", args=[req.pk]))
    assert res.status_code == 200
    assert res.data["body"] == req.body
    assert "updated_at" in res.data


@pytest.mark.django_db
def test_detail_anon_can_view_matched_or_closed(client, alice):
    """mentee が後で URL を踏み戻す動線。 status を問わず参照可能。"""
    matched = _make_request(alice, status=MentorRequest.Status.MATCHED)
    closed = _make_request(alice, status=MentorRequest.Status.CLOSED)
    for req in (matched, closed):
        res = client.get(reverse("mentor-request-detail", args=[req.pk]))
        assert res.status_code == 200


@pytest.mark.django_db
def test_detail_returns_404_for_unknown(client):
    res = client.get(reverse("mentor-request-detail", args=[999_999]))
    assert res.status_code == 404


# ---- CREATE ----


@pytest.mark.django_db
def test_create_requires_auth(client):
    res = client.post(
        reverse("mentor-request-list"),
        {"title": "x", "body": "y"},
        format="json",
    )
    assert res.status_code in {401, 403}


@pytest.mark.django_db
def test_create_success_sets_mentee_to_request_user(auth_client, alice):
    res = auth_client.post(
        reverse("mentor-request-list"),
        {"title": "AWS 教えて", "body": "ECS の IAM 周り"},
        format="json",
    )
    assert res.status_code == 201
    assert res.data["mentee"]["handle"] == "alice"
    assert MentorRequest.objects.get(pk=res.data["id"]).mentee_id == alice.pk


@pytest.mark.django_db
def test_create_with_tags(auth_client):
    _approved_tag("aws")
    _approved_tag("django")
    res = auth_client.post(
        reverse("mentor-request-list"),
        {
            "title": "T",
            "body": "B",
            "target_skill_tag_names": ["aws", "django"],
        },
        format="json",
    )
    assert res.status_code == 201
    names = sorted(t["name"] for t in res.data["target_skill_tags"])
    assert names == ["aws", "django"]


@pytest.mark.django_db
def test_create_rejects_unknown_tag(auth_client):
    res = auth_client.post(
        reverse("mentor-request-list"),
        {
            "title": "T",
            "body": "B",
            "target_skill_tag_names": ["nonexistent"],
        },
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_create_rejects_empty_title(auth_client):
    res = auth_client.post(
        reverse("mentor-request-list"),
        {"title": "", "body": "B"},
        format="json",
    )
    assert res.status_code == 400


# ---- PATCH ----


@pytest.mark.django_db
def test_patch_requires_owner(client, alice, bob):
    req = _make_request(alice, title="alice's")
    c = APIClient()
    c.force_authenticate(user=bob)
    res = c.patch(
        reverse("mentor-request-detail", args=[req.pk]),
        {"title": "hacked"},
        format="json",
    )
    assert res.status_code == 403


@pytest.mark.django_db
def test_patch_anon_forbidden(client, alice):
    req = _make_request(alice)
    res = client.patch(
        reverse("mentor-request-detail", args=[req.pk]),
        {"title": "x"},
        format="json",
    )
    assert res.status_code in {401, 403}


@pytest.mark.django_db
def test_patch_updates_title_and_body(auth_client, alice):
    req = _make_request(alice)
    res = auth_client.patch(
        reverse("mentor-request-detail", args=[req.pk]),
        {"title": "new title", "body": "new body"},
        format="json",
    )
    assert res.status_code == 200
    req.refresh_from_db()
    assert req.title == "new title"
    assert req.body == "new body"


@pytest.mark.django_db
def test_patch_rejected_when_not_open(auth_client, alice):
    req = _make_request(alice, status=MentorRequest.Status.MATCHED)
    res = auth_client.patch(
        reverse("mentor-request-detail", args=[req.pk]),
        {"title": "x"},
        format="json",
    )
    assert res.status_code == 400


# ---- DELETE / CLOSE ----


@pytest.mark.django_db
def test_delete_owner_soft_deletes_to_closed(auth_client, alice):
    req = _make_request(alice)
    res = auth_client.delete(reverse("mentor-request-detail", args=[req.pk]))
    assert res.status_code == 204
    req.refresh_from_db()
    assert req.status == MentorRequest.Status.CLOSED


@pytest.mark.django_db
def test_delete_non_owner_forbidden(alice, bob):
    req = _make_request(alice)
    c = APIClient()
    c.force_authenticate(user=bob)
    res = c.delete(reverse("mentor-request-detail", args=[req.pk]))
    assert res.status_code == 403
    req.refresh_from_db()
    assert req.status == MentorRequest.Status.OPEN


@pytest.mark.django_db
def test_close_owner_returns_updated(auth_client, alice):
    req = _make_request(alice)
    res = auth_client.post(reverse("mentor-request-close", args=[req.pk]))
    assert res.status_code == 200
    assert res.data["status"] == "closed"


@pytest.mark.django_db
def test_close_idempotent(auth_client, alice):
    req = _make_request(alice, status=MentorRequest.Status.CLOSED)
    res = auth_client.post(reverse("mentor-request-close", args=[req.pk]))
    assert res.status_code == 200  # 既に CLOSED でも 200 で返す
