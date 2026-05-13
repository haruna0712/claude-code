"""Tests for MentorshipContract complete / cancel + list / detail API (P11-17)。

spec §6.4
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.dm.models import DMRoom
from apps.mentorship.models import (
    MentorProfile,
    MentorProposal,
    MentorRequest,
    MentorshipContract,
)

User = get_user_model()


def _user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


@pytest.fixture
def alice():
    return _user("alice")


@pytest.fixture
def bob():
    return _user("bob")


@pytest.fixture
def carol():
    return _user("carol")


def _auth(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _make_contract(mentee, mentor) -> MentorshipContract:
    """ACTIVE contract を 1 つ作るヘルパ。"""
    req = MentorRequest.objects.create(mentee=mentee, title="t", body="b")
    proposal = MentorProposal.objects.create(
        request=req, mentor=mentor, body="hi", status=MentorProposal.Status.ACCEPTED
    )
    room = DMRoom.objects.create(kind=DMRoom.Kind.MENTORSHIP)
    return MentorshipContract.objects.create(
        proposal=proposal, mentee=mentee, mentor=mentor, room=room
    )


# ---- list (me) ----


@pytest.mark.django_db
def test_list_me_returns_both_roles(alice, bob, carol):
    """mentee 側 + mentor 側 両方の contract が default で返る。"""
    c1 = _make_contract(alice, bob)  # alice mentee
    c2 = _make_contract(carol, alice)  # alice mentor
    res = _auth(alice).get(reverse("mentor-contract-me-list"))
    assert res.status_code == 200
    ids = sorted(r["id"] for r in res.data)
    assert ids == sorted([c1.pk, c2.pk])


@pytest.mark.django_db
def test_list_me_role_filter(alice, bob, carol):
    c_mentee = _make_contract(alice, bob)
    c_mentor = _make_contract(carol, alice)
    res = _auth(alice).get(reverse("mentor-contract-me-list"), {"role": "mentee"})
    assert [r["id"] for r in res.data] == [c_mentee.pk]
    res2 = _auth(alice).get(reverse("mentor-contract-me-list"), {"role": "mentor"})
    assert [r["id"] for r in res2.data] == [c_mentor.pk]


@pytest.mark.django_db
def test_list_me_anon_forbidden():
    res = APIClient().get(reverse("mentor-contract-me-list"))
    assert res.status_code in {401, 403}


# ---- detail ----


@pytest.mark.django_db
def test_detail_party_only(alice, bob, carol):
    """contract 当事者 (mentee or mentor) のみ閲覧可。"""
    contract = _make_contract(alice, bob)
    res_mentee = _auth(alice).get(reverse("mentor-contract-detail", args=[contract.pk]))
    res_mentor = _auth(bob).get(reverse("mentor-contract-detail", args=[contract.pk]))
    res_third = _auth(carol).get(reverse("mentor-contract-detail", args=[contract.pk]))
    assert res_mentee.status_code == 200
    assert res_mentor.status_code == 200
    assert res_third.status_code == 403


@pytest.mark.django_db
def test_detail_404(alice):
    res = _auth(alice).get(reverse("mentor-contract-detail", args=[999_999]))
    assert res.status_code == 404


# ---- complete ----


@pytest.mark.django_db
def test_complete_by_mentee(alice, bob):
    contract = _make_contract(alice, bob)
    res = _auth(alice).post(reverse("mentor-contract-complete", args=[contract.pk]))
    assert res.status_code == 200
    contract.refresh_from_db()
    assert contract.status == MentorshipContract.Status.COMPLETED
    assert contract.completed_at is not None
    # DMRoom.is_archived=True
    assert contract.room.is_archived is True


@pytest.mark.django_db
def test_complete_by_mentor_also_allowed(alice, bob):
    contract = _make_contract(alice, bob)
    res = _auth(bob).post(reverse("mentor-contract-complete", args=[contract.pk]))
    assert res.status_code == 200
    contract.refresh_from_db()
    assert contract.status == MentorshipContract.Status.COMPLETED


@pytest.mark.django_db
def test_complete_third_party_forbidden(alice, bob, carol):
    contract = _make_contract(alice, bob)
    res = _auth(carol).post(reverse("mentor-contract-complete", args=[contract.pk]))
    assert res.status_code == 403


@pytest.mark.django_db
def test_complete_idempotent(alice, bob):
    contract = _make_contract(alice, bob)
    _auth(alice).post(reverse("mentor-contract-complete", args=[contract.pk]))
    # 2 回目は同じ contract を返す (200、 status は COMPLETED のまま)
    res = _auth(alice).post(reverse("mentor-contract-complete", args=[contract.pk]))
    assert res.status_code == 200
    contract.refresh_from_db()
    assert contract.status == MentorshipContract.Status.COMPLETED


@pytest.mark.django_db
def test_complete_after_cancel_rejected(alice, bob):
    contract = _make_contract(alice, bob)
    contract.status = MentorshipContract.Status.CANCELED
    contract.save(update_fields=["status"])
    res = _auth(alice).post(reverse("mentor-contract-complete", args=[contract.pk]))
    assert res.status_code == 400


@pytest.mark.django_db
def test_complete_increments_mentor_contract_count(alice, bob):
    """mentor profile が存在すると complete で contract_count が +1 されることを検証。"""
    MentorProfile.objects.create(user=bob, headline="m", bio="b", experience_years=1)
    contract = _make_contract(alice, bob)
    _auth(alice).post(reverse("mentor-contract-complete", args=[contract.pk]))
    bob_profile = MentorProfile.objects.get(user=bob)
    assert bob_profile.contract_count == 1


# ---- cancel ----


@pytest.mark.django_db
def test_cancel_by_party(alice, bob):
    contract = _make_contract(alice, bob)
    res = _auth(bob).post(reverse("mentor-contract-cancel", args=[contract.pk]))
    assert res.status_code == 200
    contract.refresh_from_db()
    assert contract.status == MentorshipContract.Status.CANCELED
    assert contract.room.is_archived is True


@pytest.mark.django_db
def test_cancel_after_complete_rejected(alice, bob):
    contract = _make_contract(alice, bob)
    contract.status = MentorshipContract.Status.COMPLETED
    contract.save(update_fields=["status"])
    res = _auth(alice).post(reverse("mentor-contract-cancel", args=[contract.pk]))
    assert res.status_code == 400


@pytest.mark.django_db
def test_cancel_third_party_forbidden(alice, bob, carol):
    contract = _make_contract(alice, bob)
    res = _auth(carol).post(reverse("mentor-contract-cancel", args=[contract.pk]))
    assert res.status_code == 403
