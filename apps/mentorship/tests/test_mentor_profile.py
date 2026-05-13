"""Tests for MentorProfile model (P11-11)。

spec §4.1
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError

from apps.mentorship.models import MentorProfile
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


def _profile(user, **kwargs) -> MentorProfile:
    defaults = {
        "headline": "AWS infra mentor",
        "bio": "10 years SRE experience",
        "experience_years": 10,
    }
    defaults.update(kwargs)
    return MentorProfile.objects.create(user=user, **defaults)


@pytest.mark.django_db
def test_create_basic():
    user = _user("alice")
    profile = _profile(user)
    assert profile.pk is not None
    assert profile.user_id == user.pk
    assert profile.is_accepting is True
    assert profile.proposal_count == 0
    assert profile.contract_count == 0
    assert profile.review_count == 0
    assert profile.avg_rating is None


@pytest.mark.django_db
def test_one_to_one_constraint():
    """1 user に MentorProfile は 1 つだけ。"""
    user = _user("bob")
    _profile(user)
    with pytest.raises(IntegrityError):
        _profile(user)


@pytest.mark.django_db
def test_skill_tags_m2m():
    """skill_tags は既存 Tag を流用 (spec §3)。"""
    user = _user("carol")
    aws = Tag.all_objects.create(name="aws", display_name="AWS", is_approved=True)
    py = Tag.all_objects.create(name="python", display_name="Python", is_approved=True)
    profile = _profile(user)
    profile.skill_tags.add(aws, py)
    names = sorted(profile.skill_tags.values_list("name", flat=True))
    assert names == ["aws", "python"]


@pytest.mark.django_db
def test_str_representation():
    user = _user("dan")
    profile = _profile(user)
    s = str(profile)
    assert "MentorProfile" in s
    assert "accepting=True" in s


@pytest.mark.django_db
def test_indexes_on_meta():
    """is_accepting + avg_rating index が含まれる (検索ランキング用)。"""
    fields = [list(idx.fields) for idx in MentorProfile._meta.indexes]
    assert ["is_accepting", "-avg_rating"] in fields


@pytest.mark.django_db
def test_user_cascade_delete():
    """User 削除で profile も削除される。"""
    user = _user("erin")
    profile = _profile(user)
    pk = profile.pk
    user.delete()
    assert not MentorProfile.objects.filter(pk=pk).exists()
