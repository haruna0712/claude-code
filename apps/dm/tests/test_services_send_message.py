"""``apps.dm.services.send_message`` の単体テスト (P3-03 / Issue #228).

サービス層 ``send_message`` は次を担う:

- 1:1 ルームで送信者と相手が双方向 Block 関係なら ``PermissionDenied`` (apps.dm.integrations.moderation 経由)
- ``validate_message_payload`` で空メッセージ拒否
- 添付の ``s3_key`` が ``dm/<room_id>/`` 配下に始まることを検証 (IDOR 防止)
- ``Message`` + ``MessageAttachment`` を 1 transaction で作成
- ``DMRoom.last_message_at`` を ``update_fields`` で更新
- ``transaction.on_commit`` で ``emit_dm_message`` を発火
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.test import TestCase
from django.utils import timezone

from apps.dm.models import (
    DMRoom,
    DMRoomMembership,
    Message,
)
from apps.dm.services import send_message
from apps.dm.tests._factories import make_room, make_user


class SendMessageBasicTests(TestCase):
    """body / attachments が DB に正しく書き込まれる."""

    def setUp(self) -> None:
        self.room = make_room(kind=DMRoom.Kind.GROUP)
        self.sender = make_user()
        self.other = make_user()
        DMRoomMembership.objects.create(room=self.room, user=self.sender)
        DMRoomMembership.objects.create(room=self.room, user=self.other)

    def test_creates_message_with_body_only(self) -> None:
        msg = send_message(room=self.room, sender=self.sender, body="hello", attachment_keys=[])
        self.assertIsNotNone(msg.pk)
        self.assertEqual(msg.body, "hello")
        self.assertEqual(msg.sender_id, self.sender.pk)
        self.assertEqual(msg.room_id, self.room.pk)
        self.assertEqual(msg.attachments.count(), 0)

    def test_creates_message_with_attachments(self) -> None:
        keys = [
            {
                "s3_key": f"dm/{self.room.pk}/2026/05/img1.jpg",
                "filename": "img1.jpg",
                "mime_type": "image/jpeg",
                "size": 1024,
                "width": 800,
                "height": 600,
            },
            {
                "s3_key": f"dm/{self.room.pk}/2026/05/img2.png",
                "filename": "img2.png",
                "mime_type": "image/png",
                "size": 2048,
            },
        ]
        msg = send_message(
            room=self.room, sender=self.sender, body="see attached", attachment_keys=keys
        )
        self.assertEqual(msg.attachments.count(), 2)
        first = msg.attachments.order_by("filename").first()
        self.assertEqual(first.s3_key, f"dm/{self.room.pk}/2026/05/img1.jpg")
        self.assertEqual(first.size, 1024)

    def test_updates_room_last_message_at(self) -> None:
        before = timezone.now()
        send_message(room=self.room, sender=self.sender, body="ping", attachment_keys=[])
        self.room.refresh_from_db()
        self.assertIsNotNone(self.room.last_message_at)
        self.assertGreaterEqual(self.room.last_message_at, before)


class SendMessageValidationTests(TestCase):
    def setUp(self) -> None:
        self.room = make_room(kind=DMRoom.Kind.GROUP)
        self.sender = make_user()
        DMRoomMembership.objects.create(room=self.room, user=self.sender)

    def test_rejects_empty_body_without_attachments(self) -> None:
        with self.assertRaises(ValidationError):
            send_message(room=self.room, sender=self.sender, body="", attachment_keys=[])

    def test_rejects_attachment_outside_room_prefix(self) -> None:
        """別 room の prefix を指す s3_key は IDOR 防止のため拒否."""
        other_room = make_room(kind=DMRoom.Kind.GROUP)
        keys = [
            {
                "s3_key": f"dm/{other_room.pk}/2026/05/sneaky.jpg",
                "filename": "sneaky.jpg",
                "mime_type": "image/jpeg",
                "size": 100,
            }
        ]
        with self.assertRaises(ValidationError) as ctx:
            send_message(room=self.room, sender=self.sender, body="caption", attachment_keys=keys)
        self.assertIn("attachment", str(ctx.exception).lower())

    def test_rejects_attachment_with_no_dm_prefix(self) -> None:
        keys = [
            {
                "s3_key": "tweet/123/foo.jpg",  # 別 app の prefix
                "filename": "foo.jpg",
                "mime_type": "image/jpeg",
                "size": 100,
            }
        ]
        with self.assertRaises(ValidationError):
            send_message(room=self.room, sender=self.sender, body="ok", attachment_keys=keys)


class SendMessageDirectBlockTests(TestCase):
    """1:1 (direct) で send 側と相手が Block 関係なら PermissionDenied."""

    def setUp(self) -> None:
        self.room = make_room(kind=DMRoom.Kind.DIRECT)
        self.sender = make_user()
        self.peer = make_user()
        DMRoomMembership.objects.create(room=self.room, user=self.sender)
        DMRoomMembership.objects.create(room=self.room, user=self.peer)

    def test_direct_room_rejects_when_blocked(self) -> None:
        with (
            patch("apps.dm.integrations.moderation.is_dm_blocked", return_value=True),
            self.assertRaises(PermissionDenied),
        ):
            send_message(room=self.room, sender=self.sender, body="hi", attachment_keys=[])
        # メッセージは作られていない
        self.assertEqual(Message.objects.filter(room=self.room).count(), 0)

    def test_direct_room_passes_when_not_blocked(self) -> None:
        # is_dm_blocked のスタブは False を返す (Phase 3 既定)
        msg = send_message(room=self.room, sender=self.sender, body="hi", attachment_keys=[])
        self.assertIsNotNone(msg.pk)

    def test_group_room_skips_block_check(self) -> None:
        """group room では Block 判定を呼ばない (1:1 のみが対象、N:N で各ペアの判定は重い)."""
        group_room = make_room(kind=DMRoom.Kind.GROUP)
        DMRoomMembership.objects.create(room=group_room, user=self.sender)
        DMRoomMembership.objects.create(room=group_room, user=self.peer)
        with patch(
            "apps.dm.integrations.moderation.is_dm_blocked", return_value=True
        ) as mock_block:
            msg = send_message(
                room=group_room, sender=self.sender, body="hello group", attachment_keys=[]
            )
        self.assertIsNotNone(msg.pk)
        mock_block.assert_not_called()


@pytest.mark.django_db(transaction=True)
class TestSendMessageOnCommit:
    """transaction.on_commit で emit_dm_message が発火される."""

    def test_emit_called_after_commit(self, monkeypatch) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        sender = make_user()
        recipient = make_user()
        DMRoomMembership.objects.create(room=room, user=sender)
        DMRoomMembership.objects.create(room=room, user=recipient)

        captured: list[Message] = []

        def _spy(message: Message) -> None:
            captured.append(message)

        # services.py は notifications モジュール経由で emit_dm_message を呼ぶので
        # apps.dm.integrations.notifications.emit_dm_message を差し替える。
        # on_commit は transaction commit 後に呼ばれるため、transaction=True 必須。
        monkeypatch.setattr("apps.dm.integrations.notifications.emit_dm_message", _spy)

        msg = send_message(room=room, sender=sender, body="commit-test", attachment_keys=[])

        # transaction commit 後、_spy が呼ばれている
        assert len(captured) == 1
        assert captured[0].pk == msg.pk
