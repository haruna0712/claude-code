"""DM Consumer の統合テスト (P3-03 / Issue #228).

``WebsocketCommunicator`` で実際の ASGI app を叩き、以下を確認する:

- 未認証で 4401 close
- room メンバーでないと 4403 close (IDOR 防止)
- 認証済み + room メンバーで accept
- send_message → 全メンバー (自分含む) が ``message.new`` を受信
- typing → 自分以外が ``typing.update`` を受信 (echo 抑制)
- read → ``last_read_at`` が DB に保存される + ``read.update`` broadcast
- direct + Block → 4403 相当のエラーフレーム
- rate limit 超過 → ``error/rate_limited`` フレーム
- DELETE REST → ``message.deleted`` が WebSocket で broadcast
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from channels.testing import WebsocketCommunicator
from django.conf import settings
from rest_framework_simplejwt.tokens import AccessToken

from apps.dm.models import DMRoom, DMRoomMembership, Message
from apps.dm.tests._factories import make_room, make_user

pytestmark = pytest.mark.usefixtures("in_memory_channel_layer")


def _build_cookie(user) -> bytes:
    token = AccessToken.for_user(user)
    return f"{settings.COOKIE_NAME}={token}".encode()


async def _connect(user, room_pk):
    """与えられた user / room に対して認証済 WebSocket を張る."""
    from config.asgi import application

    headers = [
        (b"origin", settings.CHANNELS_ALLOWED_ORIGINS[0].encode()),
        (b"cookie", _build_cookie(user)),
    ]
    communicator = WebsocketCommunicator(application, f"/ws/dm/{room_pk}/", headers=headers)
    return communicator


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_anonymous_is_rejected_with_4401():
    """JWT なしで接続すると 4401."""
    from config.asgi import application

    communicator = WebsocketCommunicator(
        application,
        "/ws/dm/1/",
        headers=[(b"origin", settings.CHANNELS_ALLOWED_ORIGINS[0].encode())],
    )
    connected, close_code = await communicator.connect()
    assert connected is False
    assert close_code == 4401


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_non_member_is_rejected_with_4403():
    """認証済みでも room メンバーでなければ 4403."""
    user = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)

    communicator = await _connect(user, room.pk)
    connected, close_code = await communicator.connect()
    assert connected is False
    assert close_code == 4403


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_member_connects_successfully():
    user = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, user)

    communicator = await _connect(user, room.pk)
    connected, _ = await communicator.connect()
    assert connected is True
    await communicator.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_send_message_broadcasts_to_all_members():
    sender = await _amake_user()
    other = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, sender)
    await _amake_membership(room, other)

    sender_comm = await _connect(sender, room.pk)
    other_comm = await _connect(other, room.pk)
    await sender_comm.connect()
    await other_comm.connect()

    await sender_comm.send_json_to(
        {"type": "send_message", "body": "hello world", "attachment_keys": []}
    )

    sender_msg = await sender_comm.receive_json_from()
    other_msg = await other_comm.receive_json_from()

    assert sender_msg["type"] == "message.new"
    assert sender_msg["message"]["body"] == "hello world"
    assert other_msg["type"] == "message.new"
    assert other_msg["message"]["body"] == "hello world"

    await sender_comm.disconnect()
    await other_comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_typing_does_not_echo_to_sender():
    sender = await _amake_user()
    other = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, sender)
    await _amake_membership(room, other)

    sender_comm = await _connect(sender, room.pk)
    other_comm = await _connect(other, room.pk)
    await sender_comm.connect()
    await other_comm.connect()

    await sender_comm.send_json_to({"type": "typing"})

    other_msg = await other_comm.receive_json_from()
    assert other_msg["type"] == "typing.update"
    assert other_msg["user_id"] == sender.pk

    # sender 側は何も来ない (echo 抑制)
    assert await sender_comm.receive_nothing(timeout=0.5) is True

    await sender_comm.disconnect()
    await other_comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_read_updates_last_read_at_and_broadcasts():
    sender = await _amake_user()
    other = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, sender)
    await _amake_membership(room, other)

    sender_comm = await _connect(sender, room.pk)
    other_comm = await _connect(other, room.pk)
    await sender_comm.connect()
    await other_comm.connect()

    await sender_comm.send_json_to({"type": "read"})

    # broadcast: sender 自身も other も受信する
    sender_msg = await sender_comm.receive_json_from()
    other_msg = await other_comm.receive_json_from()
    assert sender_msg["type"] == "read.update"
    assert sender_msg["user_id"] == sender.pk
    assert other_msg["type"] == "read.update"

    # DB 更新確認
    from channels.db import database_sync_to_async

    last_read = await database_sync_to_async(
        lambda: DMRoomMembership.objects.get(room=room, user=sender).last_read_at
    )()
    assert last_read is not None

    await sender_comm.disconnect()
    await other_comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_unknown_event_returns_error_frame():
    user = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, user)

    comm = await _connect(user, room.pk)
    await comm.connect()

    await comm.send_json_to({"type": "definitely_not_a_real_event"})
    msg = await comm.receive_json_from()
    assert msg["type"] == "error"
    assert msg["code"] == "unknown_event"

    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_send_message_returns_error_frame_when_blocked():
    """direct room で peer が Block 関係 → ``error/blocked`` フレーム."""
    sender = await _amake_user()
    peer = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.DIRECT)
    await _amake_membership(room, sender)
    await _amake_membership(room, peer)

    sender_comm = await _connect(sender, room.pk)
    await sender_comm.connect()

    with patch("apps.dm.integrations.moderation.is_dm_blocked", return_value=True):
        await sender_comm.send_json_to(
            {"type": "send_message", "body": "hi", "attachment_keys": []}
        )
        msg = await sender_comm.receive_json_from()
    assert msg["type"] == "error"
    assert msg["code"] == "blocked"

    await sender_comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_send_message_rate_limited(monkeypatch):
    """rate limit 超過時 ``error/rate_limited`` を返し DB に書かない."""
    user = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, user)

    async def _always_false(user_id):
        return False

    # consumers.py が ``from apps.dm.rate_limit import check_send_rate`` で名前束縛
    # しているため、consumers 側の名前を直接差し替える。
    monkeypatch.setattr("apps.dm.consumers.check_send_rate", _always_false)

    comm = await _connect(user, room.pk)
    await comm.connect()

    await comm.send_json_to({"type": "send_message", "body": "spam", "attachment_keys": []})
    msg = await comm.receive_json_from()
    assert msg["type"] == "error"
    assert msg["code"] == "rate_limited"

    # DB に Message が作られていないこと
    from channels.db import database_sync_to_async

    count = await database_sync_to_async(lambda: Message.objects.filter(room=room).count())()
    assert count == 0

    await comm.disconnect()


@pytest.mark.django_db(transaction=True)
@pytest.mark.asyncio
async def test_delete_rest_broadcasts_message_deleted(client):
    """``DELETE /api/v1/dm/messages/<id>/`` 後、WebSocket に ``message.deleted`` が来る."""
    sender = await _amake_user()
    other = await _amake_user()
    room = await _amake_room(kind=DMRoom.Kind.GROUP)
    await _amake_membership(room, sender)
    await _amake_membership(room, other)

    # WebSocket 接続を張ってから REST で削除する
    other_comm = await _connect(other, room.pk)
    await other_comm.connect()

    from channels.db import database_sync_to_async

    message = await database_sync_to_async(
        lambda: Message.objects.create(room=room, sender=sender, body="bye")
    )()

    # REST DELETE は sync。force_authenticate 風に sender でログインしてから叩く。
    @database_sync_to_async
    def _delete():
        from rest_framework.test import APIClient

        api_client = APIClient()
        api_client.force_authenticate(user=sender)
        return api_client.delete(f"/api/v1/dm/messages/{message.pk}/")

    response = await _delete()
    assert response.status_code == 204

    msg = await other_comm.receive_json_from()
    assert msg["type"] == "message.deleted"
    assert msg["message_id"] == message.pk

    await other_comm.disconnect()


# ---- 非同期 factory ヘルパ ----


async def _amake_user():
    from channels.db import database_sync_to_async

    return await database_sync_to_async(make_user)()


async def _amake_room(*, kind):
    from channels.db import database_sync_to_async

    room = await database_sync_to_async(make_room)(kind=kind)
    # URL の room_id は UUID (apps/dm/routing.py の正規表現)。DMRoom.id (UUIDField)。
    room.pk = str(room.id)  # type: ignore[attr-defined]
    return room


async def _amake_membership(room, user):
    from channels.db import database_sync_to_async

    return await database_sync_to_async(DMRoomMembership.objects.create)(room=room, user=user)
