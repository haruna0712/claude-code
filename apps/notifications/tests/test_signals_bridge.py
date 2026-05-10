"""apps/notifications/signals.py の emit_notification ブリッジ (#487).

`apps/dm/integrations/notifications.py` が呼ぶ統一エントリ。Notification を
`create_notification` 経由で永続化する。
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model

from apps.notifications.models import Notification
from apps.notifications.signals import emit_notification

User = get_user_model()


def _make_user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


@pytest.mark.django_db
def test_emit_notification_dm_invite_creates_record() -> None:
    inviter = _make_user("inviter")
    invitee = _make_user("invitee")

    emit_notification(
        recipient_id=invitee.pk,
        kind="dm_invite",
        actor_id=inviter.pk,
        room_id=1,
        invitation_id=42,
    )

    notif = Notification.objects.filter(recipient=invitee, kind="dm_invite").first()
    assert notif is not None
    assert notif.actor == inviter
    assert notif.target_type == "invitation"
    assert notif.target_id == "42"


@pytest.mark.django_db
def test_emit_notification_dm_message_creates_record() -> None:
    sender = _make_user("sender")
    recipient = _make_user("recipient")

    emit_notification(
        recipient_id=recipient.pk,
        kind="dm_message",
        actor_id=sender.pk,
        room_id=7,
        message_id=99,
    )

    notif = Notification.objects.filter(recipient=recipient, kind="dm_message").first()
    assert notif is not None
    assert notif.target_type == "message"
    assert notif.target_id == "99"


@pytest.mark.django_db
def test_emit_notification_self_skip() -> None:
    """create_notification の self-notify guard が効くこと (recipient == actor)."""
    me = _make_user("me")

    emit_notification(
        recipient_id=me.pk,
        kind="dm_invite",
        actor_id=me.pk,
        room_id=1,
        invitation_id=1,
    )

    assert Notification.objects.filter(recipient=me, kind="dm_invite").count() == 0


@pytest.mark.django_db
def test_emit_notification_unknown_recipient_silent() -> None:
    """recipient が存在しない id でも例外を上げず silent に no-op."""
    emit_notification(
        recipient_id=999999,
        kind="dm_invite",
        actor_id=None,
        invitation_id=1,
    )
    # 例外なく完了 + Notification 作成されない
    assert Notification.objects.filter(kind="dm_invite").count() == 0


@pytest.mark.django_db
def test_emit_notification_dedup_within_24h() -> None:
    inviter = _make_user("inviter2")
    invitee = _make_user("invitee2")

    emit_notification(
        recipient_id=invitee.pk,
        kind="dm_invite",
        actor_id=inviter.pk,
        invitation_id=42,
    )
    emit_notification(
        recipient_id=invitee.pk,
        kind="dm_invite",
        actor_id=inviter.pk,
        invitation_id=42,
    )
    # dedup 24h 窓で 2 回目は skip
    assert Notification.objects.filter(recipient=invitee, kind="dm_invite").count() == 1
