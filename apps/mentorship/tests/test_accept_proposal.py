"""Tests for accept_proposal service + endpoint (P11-05 / Phase 11 11-A core).

spec §3.2, §6.2

検証カテゴリ:
- atomic: MentorshipContract + DMRoom (kind=MENTORSHIP) + 両 user membership 同時作成
- idempotent: 既に ACCEPTED で contract 存在なら同じ contract を返す
- self-accept reject: mentee != by_user で 403
- 他人による accept 禁止 (mentor 自身 / 第三者 user で 403)
- request.status が OPEN 以外なら 400 (MATCHED / CLOSED / EXPIRED)
- proposal.status が PENDING/ACCEPTED 以外なら 400 (REJECTED / WITHDRAWN)
- 404 unknown proposal
- 成功時 proposal.status=ACCEPTED, request.status=MATCHED, responded_at set
- 他の同 request の PENDING proposal は変化なし (spec R8)
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.dm.models import DMRoom, DMRoomMembership
from apps.mentorship.models import (
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


def _request(mentee, **kwargs) -> MentorRequest:
    defaults = {"title": "Django で質問", "body": "DRF の認証"}
    defaults.update(kwargs)
    return MentorRequest.objects.create(mentee=mentee, **defaults)


def _proposal(request, mentor, **kwargs) -> MentorProposal:
    defaults = {"body": "Help"}
    defaults.update(kwargs)
    return MentorProposal.objects.create(request=request, mentor=mentor, **defaults)


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


URL = lambda pk: reverse("mentor-proposal-accept", args=[pk])  # noqa: E731


# ---- auth / permission ----


@pytest.mark.django_db
def test_anon_cannot_accept(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob)
    res = APIClient().post(URL(p.pk))
    assert res.status_code in {401, 403}


@pytest.mark.django_db
def test_non_owner_cannot_accept(alice, bob, carol):
    """request.mentee 以外 (mentor 自身も含む) は accept 不可。"""
    req = _request(alice)
    p = _proposal(req, bob)
    res_mentor = _auth(bob).post(URL(p.pk))
    res_third = _auth(carol).post(URL(p.pk))
    assert res_mentor.status_code == 403
    assert res_third.status_code == 403


@pytest.mark.django_db
def test_returns_404_for_unknown_proposal(alice):
    res = _auth(alice).post(URL(999_999))
    assert res.status_code == 404


# ---- success path ----


@pytest.mark.django_db
def test_accept_creates_contract_and_dmroom(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob)
    res = _auth(alice).post(URL(p.pk))
    assert res.status_code == 201

    c = MentorshipContract.objects.get(pk=res.data["id"])
    assert c.mentee_id == alice.pk
    assert c.mentor_id == bob.pk
    assert c.status == MentorshipContract.Status.ACTIVE
    assert c.is_paid is False
    assert c.paid_amount_jpy == 0

    # DMRoom が kind=MENTORSHIP で作られ、 両 user が member
    room = DMRoom.objects.get(pk=c.room_id)
    assert room.kind == DMRoom.Kind.MENTORSHIP
    members = set(DMRoomMembership.objects.filter(room=room).values_list("user_id", flat=True))
    assert members == {alice.pk, bob.pk}


@pytest.mark.django_db
def test_accept_updates_proposal_and_request_status(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob)
    _auth(alice).post(URL(p.pk))
    p.refresh_from_db()
    req.refresh_from_db()
    assert p.status == MentorProposal.Status.ACCEPTED
    assert p.responded_at is not None
    assert req.status == MentorRequest.Status.MATCHED


# ---- idempotency ----


@pytest.mark.django_db
def test_accept_is_idempotent(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob)
    res1 = _auth(alice).post(URL(p.pk))
    contract1_id = res1.data["id"]
    res2 = _auth(alice).post(URL(p.pk))
    contract2_id = res2.data["id"]
    assert contract1_id == contract2_id
    assert MentorshipContract.objects.count() == 1


# ---- guards ----


@pytest.mark.django_db
def test_cannot_accept_when_request_not_open(alice, bob):
    """別 proposal で既に MATCHED なら新たな accept は 400。"""
    req = _request(alice, status=MentorRequest.Status.MATCHED)
    p = _proposal(req, bob)
    res = _auth(alice).post(URL(p.pk))
    assert res.status_code == 400


@pytest.mark.django_db
def test_cannot_accept_when_proposal_rejected(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob, status=MentorProposal.Status.REJECTED)
    res = _auth(alice).post(URL(p.pk))
    assert res.status_code == 400


@pytest.mark.django_db
def test_cannot_accept_when_proposal_withdrawn(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob, status=MentorProposal.Status.WITHDRAWN)
    res = _auth(alice).post(URL(p.pk))
    assert res.status_code == 400


@pytest.mark.django_db
def test_other_pending_proposals_remain_unchanged(alice, bob, carol):
    """spec R8: bob の proposal を accept しても carol の PENDING は触らない。"""
    req = _request(alice)
    p_bob = _proposal(req, bob)
    p_carol = _proposal(req, carol)
    _auth(alice).post(URL(p_bob.pk))
    p_carol.refresh_from_db()
    assert p_carol.status == MentorProposal.Status.PENDING


# ---- model layer ----


@pytest.mark.django_db
def test_model_str(alice, bob):
    req = _request(alice)
    p = _proposal(req, bob)
    room = DMRoom.objects.create(kind=DMRoom.Kind.MENTORSHIP)
    c = MentorshipContract.objects.create(proposal=p, mentee=alice, mentor=bob, room=room)
    s = str(c)
    assert "MentorshipContract" in s
    assert "active" in s
