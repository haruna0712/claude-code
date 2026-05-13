"""Celery beat tasks for mentorship (P11-24)。

spec §8 R12。 mentor_request の `expires_at` 経過 + status=OPEN な行を EXPIRED に
flip する。 1 日 1 回 schedule (Celery beat 設定は config/celery_app.py / settings)。
"""

from __future__ import annotations

from celery import shared_task
from django.utils import timezone

from apps.mentorship.models import MentorRequest


@shared_task(name="apps.mentorship.tasks.expire_requests")
def expire_requests() -> int:
    """`status=OPEN AND expires_at < now()` を EXPIRED に bulk update。

    Returns:
        flip した row 数。
    """

    now = timezone.now()
    count = MentorRequest.objects.filter(
        status=MentorRequest.Status.OPEN,
        expires_at__lt=now,
    ).update(status=MentorRequest.Status.EXPIRED)
    return count
