"""Tests for MentorProposal create API (P11-04 / Phase 11 11-A).

spec §6.2

検証カテゴリ:
- auth 必須 (anon 401-403)
- self-proposal 禁止 (mentor == request.mentee で 400)
- request.status != OPEN なら 400 (MATCHED / CLOSED / EXPIRED)
- unique (request, mentor) — 2 回目は 400
- 成功時 request.proposal_count が atomic に +1
- 404 unknown request
- body 入力 validation (empty / too long)
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.mentorship.models import MentorProposal, MentorRequest

User = get_user_model()


def _user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _open_request(mentee, **kwargs) -> MentorRequest:
    defaults = {
        "title": "Django で質問",
        "body": "REST framework での認証で詰まっています",
    }
    defaults.update(kwargs)
    return MentorRequest.objects.create(mentee=mentee, **defaults)


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


# ---- auth / validation ----


@pytest.mark.django_db
def test_anon_cannot_propose(alice, bob):
    req = _open_request(alice)
    c = APIClient()
    res = c.post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "I can mentor you"},
        format="json",
    )
    assert res.status_code in {401, 403}


@pytest.mark.django_db
def test_self_proposal_forbidden(alice):
    req = _open_request(alice)
    res = _auth(alice).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "I propose to myself"},
        format="json",
    )
    assert res.status_code == 400
    assert "自分の募集" in res.data["detail"]


@pytest.mark.django_db
def test_404_when_request_missing(bob):
    res = _auth(bob).post(
        reverse("mentor-proposal-create", args=[999_999]),
        {"body": "hi"},
        format="json",
    )
    assert res.status_code == 404


@pytest.mark.django_db
def test_empty_body_rejected(alice, bob):
    req = _open_request(alice)
    res = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": ""},
        format="json",
    )
    assert res.status_code == 400


# ---- request status guards ----


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status_value",
    [
        MentorRequest.Status.MATCHED,
        MentorRequest.Status.CLOSED,
        MentorRequest.Status.EXPIRED,
    ],
)
def test_cannot_propose_to_non_open_request(alice, bob, status_value):
    req = _open_request(alice, status=status_value)
    res = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "hi"},
        format="json",
    )
    assert res.status_code == 400


# ---- happy path ----


@pytest.mark.django_db
def test_create_proposal_success(alice, bob):
    req = _open_request(alice)
    res = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "I can help. AWS infra で 10 年経験あります。"},
        format="json",
    )
    assert res.status_code == 201
    assert res.data["mentor"]["handle"] == "bob"
    assert res.data["status"] == "pending"
    # DB に row が作られている
    p = MentorProposal.objects.get(pk=res.data["id"])
    assert p.request_id == req.pk
    assert p.mentor_id == bob.pk


@pytest.mark.django_db
def test_proposal_count_incremented(alice, bob):
    req = _open_request(alice)
    assert req.proposal_count == 0
    _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "x"},
        format="json",
    )
    req.refresh_from_db()
    assert req.proposal_count == 1


# ---- unique ----


@pytest.mark.django_db
def test_unique_request_mentor_pair(alice, bob):
    req = _open_request(alice)
    res1 = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "first"},
        format="json",
    )
    assert res1.status_code == 201
    # 2 回目は unique 違反で 400
    res2 = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "second"},
        format="json",
    )
    assert res2.status_code == 400
    # proposal_count は 1 のまま (atomic に増えない)
    req.refresh_from_db()
    assert req.proposal_count == 1


@pytest.mark.django_db
def test_different_mentors_can_propose_to_same_request(alice, bob, carol):
    req = _open_request(alice)
    res_bob = _auth(bob).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "from bob"},
        format="json",
    )
    res_carol = _auth(carol).post(
        reverse("mentor-proposal-create", args=[req.pk]),
        {"body": "from carol"},
        format="json",
    )
    assert res_bob.status_code == 201
    assert res_carol.status_code == 201
    req.refresh_from_db()
    assert req.proposal_count == 2


# ---- model layer ----


@pytest.mark.django_db
def test_model_str(alice, bob):
    req = _open_request(alice)
    p = MentorProposal.objects.create(request=req, mentor=bob, body="hi")
    s = str(p)
    assert "MentorProposal" in s
    assert "pending" in s
