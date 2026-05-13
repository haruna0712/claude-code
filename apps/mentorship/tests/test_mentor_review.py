"""Tests for MentorReview submit + list API (P11-20)。

spec §4.6, §6.4
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from apps.dm.models import DMRoom
from apps.mentorship.models import (
    MentorProfile,
    MentorProposal,
    MentorRequest,
    MentorReview,
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


def _completed_contract(mentee, mentor) -> MentorshipContract:
    req = MentorRequest.objects.create(mentee=mentee, title="t", body="b")
    proposal = MentorProposal.objects.create(
        request=req,
        mentor=mentor,
        body="hi",
        status=MentorProposal.Status.ACCEPTED,
    )
    room = DMRoom.objects.create(kind=DMRoom.Kind.MENTORSHIP)
    return MentorshipContract.objects.create(
        proposal=proposal,
        mentee=mentee,
        mentor=mentor,
        room=room,
        status=MentorshipContract.Status.COMPLETED,
    )


# ---- submit review ----


@pytest.mark.django_db
def test_submit_review_by_mentee(alice, bob):
    contract = _completed_contract(alice, bob)
    res = _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "great mentor"},
        format="json",
    )
    assert res.status_code == 201
    assert res.data["rating"] == 5
    review = MentorReview.objects.get(contract=contract)
    assert review.mentor_id == bob.pk
    assert review.mentee_id == alice.pk


@pytest.mark.django_db
def test_submit_review_mentor_forbidden(alice, bob):
    contract = _completed_contract(alice, bob)
    res = _auth(bob).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "self"},
        format="json",
    )
    assert res.status_code == 403


@pytest.mark.django_db
def test_submit_review_third_party_forbidden(alice, bob, carol):
    contract = _completed_contract(alice, bob)
    res = _auth(carol).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "x"},
        format="json",
    )
    assert res.status_code == 403


@pytest.mark.django_db
def test_submit_review_rejects_active_contract(alice, bob):
    """COMPLETED 以外の契約には review 投稿不可。"""
    contract = _completed_contract(alice, bob)
    contract.status = MentorshipContract.Status.ACTIVE
    contract.save(update_fields=["status"])
    res = _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "x"},
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_submit_review_rejects_invalid_rating(alice, bob):
    contract = _completed_contract(alice, bob)
    res = _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 6, "comment": "x"},
        format="json",
    )
    assert res.status_code == 400


@pytest.mark.django_db
def test_resubmit_updates_existing_review(alice, bob):
    contract = _completed_contract(alice, bob)
    _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 3, "comment": "first"},
        format="json",
    )
    _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "second"},
        format="json",
    )
    assert MentorReview.objects.filter(contract=contract).count() == 1
    review = MentorReview.objects.get(contract=contract)
    assert review.rating == 5
    assert review.comment == "second"


@pytest.mark.django_db
def test_submit_review_updates_profile_aggregates(alice, bob):
    """投稿で MentorProfile.avg_rating / review_count が再集計される。"""
    profile = MentorProfile.objects.create(user=bob, headline="m", bio="b", experience_years=3)
    contract = _completed_contract(alice, bob)
    _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 4, "comment": "ok"},
        format="json",
    )
    profile.refresh_from_db()
    assert profile.review_count == 1
    assert profile.avg_rating == Decimal("4.00")


@pytest.mark.django_db
def test_submit_review_avg_recomputed_for_two_contracts(alice, bob, carol):
    """alice (mentee) + carol (mentee 2) が bob を review、 avg = 平均。"""
    MentorProfile.objects.create(user=bob, headline="m", bio="b", experience_years=3)
    c1 = _completed_contract(alice, bob)
    c2 = _completed_contract(carol, bob)
    _auth(alice).post(
        reverse("mentor-contract-review", args=[c1.pk]),
        {"rating": 5, "comment": "5"},
        format="json",
    )
    _auth(carol).post(
        reverse("mentor-contract-review", args=[c2.pk]),
        {"rating": 3, "comment": "3"},
        format="json",
    )
    profile = MentorProfile.objects.get(user=bob)
    assert profile.review_count == 2
    assert profile.avg_rating == Decimal("4.00")  # (5+3)/2


# ---- public list /mentors/<handle>/reviews/ ----


@pytest.mark.django_db
def test_public_reviews_list_anon(alice, bob):
    contract = _completed_contract(alice, bob)
    _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 5, "comment": "great"},
        format="json",
    )
    res = APIClient().get(reverse("mentor-reviews", args=["bob"]))
    assert res.status_code == 200
    assert len(res.data) == 1
    assert res.data[0]["rating"] == 5


@pytest.mark.django_db
def test_public_reviews_hides_invisible(alice, bob):
    contract = _completed_contract(alice, bob)
    _auth(alice).post(
        reverse("mentor-contract-review", args=[contract.pk]),
        {"rating": 2, "comment": "bad"},
        format="json",
    )
    MentorReview.objects.filter(contract=contract).update(is_visible=False)
    res = APIClient().get(reverse("mentor-reviews", args=["bob"]))
    assert res.status_code == 200
    assert res.data == []
