"""Tests for /mentors/ public search + /mentors/<handle>/ detail (P11-13)。

spec §6.3
"""

from __future__ import annotations

from decimal import Decimal

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


def _profile(user, **kwargs) -> MentorProfile:
    defaults = {"headline": "m", "bio": "b", "experience_years": 3}
    defaults.update(kwargs)
    return MentorProfile.objects.create(user=user, **defaults)


# ---- LIST ----


@pytest.mark.django_db
def test_list_anon_default_only_accepting():
    """default で is_accepting=True のみ可視。"""
    a = _user("alice")
    b = _user("bob")
    _profile(a, is_accepting=True)
    _profile(b, is_accepting=False)
    res = APIClient().get(reverse("mentor-list"))
    assert res.status_code == 200
    handles = [r["user"]["handle"] for r in res.data["results"]]
    assert handles == ["alice"]


@pytest.mark.django_db
def test_list_accepting_all_includes_inactive():
    a = _user("alice")
    b = _user("bob")
    _profile(a, is_accepting=True)
    _profile(b, is_accepting=False)
    res = APIClient().get(reverse("mentor-list"), {"accepting": "all"})
    handles = sorted(r["user"]["handle"] for r in res.data["results"])
    assert handles == ["alice", "bob"]


@pytest.mark.django_db
def test_list_tag_filter():
    a = _user("alice")
    b = _user("bob")
    aws = _approved_tag("aws")
    django_tag = _approved_tag("django")
    pa = _profile(a)
    pa.skill_tags.add(aws)
    pb = _profile(b)
    pb.skill_tags.add(django_tag)
    res = APIClient().get(reverse("mentor-list"), {"tag": "aws"})
    handles = [r["user"]["handle"] for r in res.data["results"]]
    assert handles == ["alice"]


@pytest.mark.django_db
def test_list_includes_plans_inline():
    """list response の各 row は plans を埋め込む (P11-12 で SerializerMethod)。"""
    a = _user("alice")
    profile = _profile(a)
    MentorPlan.objects.create(
        profile=profile, title="60 min", description="d", billing_cycle="one_time"
    )
    res = APIClient().get(reverse("mentor-list"))
    plans = res.data["results"][0]["plans"]
    assert len(plans) == 1
    assert plans[0]["title"] == "60 min"


@pytest.mark.django_db
def test_list_ordering_by_avg_rating_desc():
    """avg_rating 降順で並ぶ。"""
    a = _user("alice")
    b = _user("bob")
    c = _user("carol")
    _profile(a, headline="A", avg_rating=Decimal("4.50"))
    _profile(b, headline="B", avg_rating=Decimal("4.80"))
    _profile(c, headline="C", avg_rating=Decimal("3.00"))
    res = APIClient().get(reverse("mentor-list"))
    handles = [r["user"]["handle"] for r in res.data["results"]]
    assert handles == ["bob", "alice", "carol"]


# ---- DETAIL ----


@pytest.mark.django_db
def test_detail_anon_can_view():
    a = _user("alice")
    _profile(a, headline="AWS mentor")
    res = APIClient().get(reverse("mentor-detail", args=["alice"]))
    assert res.status_code == 200
    assert res.data["headline"] == "AWS mentor"
    assert res.data["user"]["handle"] == "alice"


@pytest.mark.django_db
def test_detail_404_for_user_without_profile():
    """profile 未作成の user は 404。"""
    _user("bob")
    res = APIClient().get(reverse("mentor-detail", args=["bob"]))
    assert res.status_code == 404


@pytest.mark.django_db
def test_detail_404_for_unknown_handle():
    res = APIClient().get(reverse("mentor-detail", args=["nobody"]))
    assert res.status_code == 404
