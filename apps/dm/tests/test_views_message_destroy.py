"""``DELETE /api/v1/dm/messages/<id>/`` の REST 単体テスト (P3-03 / Issue #228).

WebSocket 経由の broadcast 連動は ``test_consumer.py::test_delete_rest_broadcasts_message_deleted``
側でカバー済。本ファイルでは REST エンドポイント単体の権限・冪等性・存在確認漏洩を検証。

カバー観点 (security/code HIGH H-1 反映):

- 401: 未認証
- 403: 自分以外の送信メッセージを削除
- 204: 自分の送信を soft-delete 成功
- 404: 既に削除済 (queryset から外れて probing 防止)
- 404: room メンバーでない
- 404: 存在しない pk
"""

from __future__ import annotations

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.dm.models import DMRoom, DMRoomMembership, Message
from apps.dm.tests._factories import make_room, make_user

pytestmark = pytest.mark.django_db


def _api(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def _make_message_in_room(*, sender, room) -> Message:
    return Message.objects.create(room=room, sender=sender, body="hi")


def test_unauthenticated_returns_401() -> None:
    user = make_user()
    room = make_room(kind=DMRoom.Kind.GROUP)
    DMRoomMembership.objects.create(room=room, user=user)
    msg = _make_message_in_room(sender=user, room=room)

    response = _api().delete(f"/api/v1/dm/messages/{msg.pk}/")
    assert response.status_code == 401


def test_owner_can_soft_delete_with_204() -> None:
    user = make_user()
    other = make_user()
    room = make_room(kind=DMRoom.Kind.GROUP)
    DMRoomMembership.objects.create(room=room, user=user)
    DMRoomMembership.objects.create(room=room, user=other)
    msg = _make_message_in_room(sender=user, room=room)

    response = _api(user).delete(f"/api/v1/dm/messages/{msg.pk}/")
    assert response.status_code == 204

    msg.refresh_from_db()
    assert msg.deleted_at is not None


def test_non_owner_member_gets_403() -> None:
    sender = make_user()
    other = make_user()
    room = make_room(kind=DMRoom.Kind.GROUP)
    DMRoomMembership.objects.create(room=room, user=sender)
    DMRoomMembership.objects.create(room=room, user=other)
    msg = _make_message_in_room(sender=sender, room=room)

    response = _api(other).delete(f"/api/v1/dm/messages/{msg.pk}/")
    assert response.status_code == 403


def test_already_deleted_returns_404_not_idempotent_204() -> None:
    """sec H-1: idempotent 204 を返すと攻撃者に存在を漏らすため、削除済は 404 で隠す."""
    user = make_user()
    room = make_room(kind=DMRoom.Kind.GROUP)
    DMRoomMembership.objects.create(room=room, user=user)
    msg = _make_message_in_room(sender=user, room=room)
    msg.deleted_at = timezone.now()
    msg.save(update_fields=["deleted_at", "updated_at"])

    response = _api(user).delete(f"/api/v1/dm/messages/{msg.pk}/")
    assert response.status_code == 404


def test_non_member_gets_404_not_403() -> None:
    """sec H-1: 別 room のメッセージは存在自体を 404 で隠す (probing 防止)."""
    sender = make_user()
    outsider = make_user()
    room = make_room(kind=DMRoom.Kind.GROUP)
    DMRoomMembership.objects.create(room=room, user=sender)
    # outsider は room の member ではない
    msg = _make_message_in_room(sender=sender, room=room)

    response = _api(outsider).delete(f"/api/v1/dm/messages/{msg.pk}/")
    assert response.status_code == 404


def test_nonexistent_pk_returns_404() -> None:
    user = make_user()
    response = _api(user).delete("/api/v1/dm/messages/9999999/")
    assert response.status_code == 404
