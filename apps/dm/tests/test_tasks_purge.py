"""apps.dm.tasks.purge_orphan_attachments テスト (P3-06 / Issue #231)."""

from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.dm.models import MessageAttachment
from apps.dm.tasks import ORPHAN_TTL_MINUTES, purge_orphan_attachments
from apps.dm.tests._factories import make_membership, make_room, make_user


def _make_orphan(*, age_minutes: int) -> MessageAttachment:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)
    att = MessageAttachment.objects.create(
        message=None,
        room=room,
        uploaded_by=user,
        s3_key=f"dm/{room.pk}/2026/05/orphan-{age_minutes}.jpg",
        filename="x.jpg",
        mime_type="image/jpeg",
        size=10,
    )
    # auto_now_add は OVERRIDE 不能なため、UPDATE で過去日付に上書きする。
    past = timezone.now() - timedelta(minutes=age_minutes)
    MessageAttachment.objects.filter(pk=att.pk).update(created_at=past)
    att.refresh_from_db()
    return att


@pytest.mark.django_db
def test_purge_deletes_orphan_older_than_ttl() -> None:
    old = _make_orphan(age_minutes=ORPHAN_TTL_MINUTES + 5)

    with patch("apps.dm.tasks.delete_object") as delete_mock:
        result = purge_orphan_attachments()

    delete_mock.assert_called_once_with(s3_key=old.s3_key)
    assert result["deleted_db"] == 1
    assert result["s3_attempted"] == 1
    assert not MessageAttachment.objects.filter(pk=old.pk).exists()


@pytest.mark.django_db
def test_purge_keeps_recent_orphan() -> None:
    recent = _make_orphan(age_minutes=ORPHAN_TTL_MINUTES - 5)

    with patch("apps.dm.tasks.delete_object") as delete_mock:
        result = purge_orphan_attachments()

    assert result["deleted_db"] == 0
    delete_mock.assert_not_called()
    assert MessageAttachment.objects.filter(pk=recent.pk).exists()


@pytest.mark.django_db
def test_purge_keeps_non_orphan() -> None:
    """``message`` が紐付いている attachment は age に関わらず GC されない."""
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)
    from apps.dm.models import Message

    msg = Message.objects.create(room=room, sender=user, body="hi")
    att = MessageAttachment.objects.create(
        message=msg,
        room=room,
        uploaded_by=user,
        s3_key=f"dm/{room.pk}/2026/05/linked.jpg",
        filename="x.jpg",
        mime_type="image/jpeg",
        size=10,
    )
    # 古くする
    past = timezone.now() - timedelta(days=10)
    MessageAttachment.objects.filter(pk=att.pk).update(created_at=past)

    with patch("apps.dm.tasks.delete_object"):
        result = purge_orphan_attachments()

    assert result["deleted_db"] == 0
    assert MessageAttachment.objects.filter(pk=att.pk).exists()


@pytest.mark.django_db
def test_purge_continues_if_s3_delete_raises() -> None:
    """S3 削除が unexpected exception でも DB 行は削除を続行する."""
    old = _make_orphan(age_minutes=ORPHAN_TTL_MINUTES + 10)

    with patch("apps.dm.tasks.delete_object", side_effect=RuntimeError("boom")):
        result = purge_orphan_attachments()

    assert result["s3_failed"] == 1
    assert result["deleted_db"] == 1
    assert not MessageAttachment.objects.filter(pk=old.pk).exists()
