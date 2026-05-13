"""Tests for `MentorRequest` model (P11-02 / Phase 11 11-A).

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §4.3
"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.mentorship.models import REQUEST_EXPIRY_DAYS, MentorRequest
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


def _request(mentee, **kwargs):
    defaults = {
        "title": "Django について教えてほしい",
        "body": "REST framework での認証周りで詰まっています。",
    }
    defaults.update(kwargs)
    return MentorRequest.objects.create(mentee=mentee, **defaults)


@pytest.mark.django_db
def test_create_mentor_request_basic():
    """create + str() / 主要 field が保持される。"""
    user = _user("alice")
    req = _request(user)
    assert req.pk is not None
    assert "alice" not in str(req)  # mentee_id (int) で十分、 username は出さない
    assert "Django について" in str(req)
    # str() に status と mentee_id が含まれる
    assert "open" in str(req)
    assert str(user.pk) in str(req)


@pytest.mark.django_db
def test_status_default_is_open():
    user = _user("bob")
    req = _request(user)
    assert req.status == MentorRequest.Status.OPEN


@pytest.mark.django_db
def test_expires_at_default_is_30_days_after_created():
    """expires_at default は created_at の 30 日後 (±10 秒 の許容)。"""
    user = _user("carol")
    before = timezone.now()
    req = _request(user)
    after = timezone.now()
    expected_min = before + timedelta(days=REQUEST_EXPIRY_DAYS)
    expected_max = after + timedelta(days=REQUEST_EXPIRY_DAYS)
    assert expected_min <= req.expires_at <= expected_max


@pytest.mark.django_db
def test_proposal_count_default_zero():
    user = _user("dan")
    req = _request(user)
    assert req.proposal_count == 0


@pytest.mark.django_db
def test_budget_jpy_default_zero_for_free_beta():
    user = _user("erin")
    req = _request(user)
    assert req.budget_jpy == 0


@pytest.mark.django_db
def test_status_transition_open_to_matched():
    """OPEN → MATCHED への状態遷移が単純な assignment + save() で動く。"""
    user = _user("frank")
    req = _request(user)
    req.status = MentorRequest.Status.MATCHED
    req.save(update_fields=["status"])
    req.refresh_from_db()
    assert req.status == MentorRequest.Status.MATCHED


@pytest.mark.django_db
def test_target_skill_tags_m2m():
    """既存 Tag を M2M で関連付けできる (spec §3 タグ流用)。

    Tag.objects は ApprovedTagManager で is_approved=True に filter されるので、
    テストでは all_objects + is_approved=True で create する。
    """
    user = _user("greta")
    tag_django = Tag.all_objects.create(name="django", display_name="Django", is_approved=True)
    tag_drf = Tag.all_objects.create(name="drf", display_name="DRF", is_approved=True)
    req = _request(user)
    req.target_skill_tags.add(tag_django, tag_drf)
    names = sorted(req.target_skill_tags.values_list("name", flat=True))
    assert names == ["django", "drf"]


@pytest.mark.django_db
def test_indexes_on_meta():
    """Meta.indexes に status+created_at と mentee+created_at が含まれる (spec §4.3)。"""
    fields_list = [list(idx.fields) for idx in MentorRequest._meta.indexes]
    assert ["status", "-created_at"] in fields_list
    assert ["mentee", "-created_at"] in fields_list
