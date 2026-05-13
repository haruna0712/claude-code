"""Tests for MentorProfile self-edit + MentorPlan CRUD API (P11-12)。

spec §6.3
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.mentorship.models import MentorPlan, MentorProfile
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
    return Tag.all_objects.create(name=name, display_name=name.capitalize(), is_approved=True)


@pytest.fixture
def alice():
    return _user("alice")


@pytest.fixture
def bob():
    return _user("bob")


def _auth(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


# ---- MentorProfile self-edit ----


@pytest.mark.django_db
def test_get_me_404_when_no_profile(alice):
    res = _auth(alice).get(reverse("mentor-profile-me"))
    assert res.status_code == 404


@pytest.mark.django_db
def test_patch_me_auto_creates_profile(alice):
    """PATCH /mentors/me/ で profile が無くても auto-create される。"""
    _approved_tag("aws")
    res = _auth(alice).patch(
        reverse("mentor-profile-me"),
        {
            "headline": "AWS mentor",
            "bio": "I help with AWS",
            "experience_years": 8,
            "is_accepting": True,
            "skill_tag_names": ["aws"],
        },
        format="json",
    )
    assert res.status_code == 200
    profile = MentorProfile.objects.get(user=alice)
    assert profile.headline == "AWS mentor"
    assert profile.experience_years == 8
    names = sorted(profile.skill_tags.values_list("name", flat=True))
    assert names == ["aws"]


@pytest.mark.django_db
def test_patch_me_updates_existing(alice):
    """既存 profile を update_or_create で上書き。"""
    MentorProfile.objects.create(user=alice, headline="old", bio="old bio", experience_years=1)
    res = _auth(alice).patch(
        reverse("mentor-profile-me"),
        {
            "headline": "new",
            "bio": "new bio",
            "experience_years": 5,
            "is_accepting": False,
        },
        format="json",
    )
    assert res.status_code == 200
    profile = MentorProfile.objects.get(user=alice)
    assert profile.headline == "new"
    assert profile.experience_years == 5
    assert profile.is_accepting is False


@pytest.mark.django_db
def test_anon_cannot_patch_me():
    res = APIClient().patch(
        reverse("mentor-profile-me"),
        {"headline": "x", "bio": "y", "experience_years": 0},
        format="json",
    )
    assert res.status_code in {401, 403}


# ---- MentorPlan CRUD ----


def _profile(user) -> MentorProfile:
    return MentorProfile.objects.create(user=user, headline="m", bio="b", experience_years=3)


@pytest.mark.django_db
def test_plan_list_404_without_profile(alice):
    res = _auth(alice).get(reverse("mentor-plan-list"))
    assert res.status_code == 404


@pytest.mark.django_db
def test_plan_create_success(alice):
    _profile(alice)
    res = _auth(alice).post(
        reverse("mentor-plan-list"),
        {
            "title": "AWS 60 分単発",
            "description": "ECS / IAM 周り",
            "price_jpy": 0,
            "billing_cycle": "one_time",
        },
        format="json",
    )
    assert res.status_code == 201
    assert res.data["title"] == "AWS 60 分単発"
    assert res.data["billing_cycle"] == "one_time"
    plan = MentorPlan.objects.get(pk=res.data["id"])
    assert plan.profile.user_id == alice.pk
    assert plan.is_active is True


@pytest.mark.django_db
def test_plan_list_returns_only_active(alice):
    profile = _profile(alice)
    MentorPlan.objects.create(
        profile=profile,
        title="active",
        description="d",
        billing_cycle="monthly",
        is_active=True,
    )
    MentorPlan.objects.create(
        profile=profile,
        title="inactive",
        description="d",
        billing_cycle="monthly",
        is_active=False,
    )
    res = _auth(alice).get(reverse("mentor-plan-list"))
    titles = [p["title"] for p in res.data]
    assert titles == ["active"]


@pytest.mark.django_db
def test_plan_patch_owner_only(alice, bob):
    """他人の plan は patch 不可。"""
    _profile(bob)
    profile = _profile(alice)
    plan = MentorPlan.objects.create(
        profile=profile, title="t", description="d", billing_cycle="one_time"
    )
    res = _auth(bob).patch(
        reverse("mentor-plan-detail", args=[plan.pk]),
        {"title": "hacked"},
        format="json",
    )
    assert res.status_code == 403


@pytest.mark.django_db
def test_plan_patch_updates_fields(alice):
    profile = _profile(alice)
    plan = MentorPlan.objects.create(
        profile=profile, title="t", description="d", billing_cycle="one_time"
    )
    res = _auth(alice).patch(
        reverse("mentor-plan-detail", args=[plan.pk]),
        {"title": "new", "price_jpy": 0},
        format="json",
    )
    assert res.status_code == 200
    plan.refresh_from_db()
    assert plan.title == "new"


@pytest.mark.django_db
def test_plan_delete_is_soft(alice):
    """DELETE は is_active=False の論理削除 (row は残す)。"""
    profile = _profile(alice)
    plan = MentorPlan.objects.create(
        profile=profile, title="t", description="d", billing_cycle="one_time"
    )
    res = _auth(alice).delete(reverse("mentor-plan-detail", args=[plan.pk]))
    assert res.status_code == 204
    plan.refresh_from_db()
    assert plan.is_active is False


@pytest.mark.django_db
def test_plan_create_rejects_invalid_billing_cycle(alice):
    _profile(alice)
    res = _auth(alice).post(
        reverse("mentor-plan-list"),
        {
            "title": "x",
            "description": "y",
            "billing_cycle": "yearly",  # 未対応
        },
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_profile_includes_active_plans_only(alice):
    """GET /mentors/me/ の plans field は is_active=True のみ。"""
    profile = _profile(alice)
    MentorPlan.objects.create(
        profile=profile,
        title="P1",
        description="d",
        billing_cycle="one_time",
        is_active=True,
    )
    MentorPlan.objects.create(
        profile=profile,
        title="P2",
        description="d",
        billing_cycle="one_time",
        is_active=False,
    )
    res = _auth(alice).get(reverse("mentor-profile-me"))
    assert res.status_code == 200
    titles = [p["title"] for p in res.data["plans"]]
    assert titles == ["P1"]
