"""Tests for expire_requests Celery beat task (P11-24)。"""

from __future__ import annotations

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.mentorship.models import MentorRequest
from apps.mentorship.tasks import expire_requests

User = get_user_model()


@pytest.mark.django_db
def test_expire_requests_flips_old_open_to_expired():
    user = User.objects.create_user(
        username="alice",
        email="alice@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="A",
        last_name="L",
    )
    past = timezone.now() - timedelta(days=1)
    # 期限切れ + OPEN
    expired_target = MentorRequest.objects.create(mentee=user, title="old", body="b")
    MentorRequest.objects.filter(pk=expired_target.pk).update(expires_at=past)

    # まだ期限内
    fresh = MentorRequest.objects.create(mentee=user, title="fresh", body="b")

    # 既に MATCHED は touch しない
    matched = MentorRequest.objects.create(mentee=user, title="m", body="b")
    MentorRequest.objects.filter(pk=matched.pk).update(
        expires_at=past, status=MentorRequest.Status.MATCHED
    )

    flipped = expire_requests()
    assert flipped == 1

    expired_target.refresh_from_db()
    fresh.refresh_from_db()
    matched.refresh_from_db()
    assert expired_target.status == MentorRequest.Status.EXPIRED
    assert fresh.status == MentorRequest.Status.OPEN
    assert matched.status == MentorRequest.Status.MATCHED
