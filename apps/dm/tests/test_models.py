"""DM 6 モデルの単体テスト (P3-01 / Issue #226)。

ER §2.14 と Issue P3-01 の作業内容に従い、以下を検証する:

- 各モデルの作成
- ``UniqueConstraint`` の挙動
- ``CASCADE`` / ``SET_NULL`` の挙動 (User / DMRoom / Message 削除時の連鎖)
- ``Message.body`` の 5000 字上限
- ``MessageAttachment`` が ``s3_key`` を ``CharField`` で保持する (S3 直接アップロードのため
  Django storage 経由しない、Issue P3-01 の ER 逸脱)
- ``MessageReadReceipt`` の定義 (Phase 3 ではビジネスロジックでは使わないが、
  ER §2.14 にあるためモデルとしては存在する)
- ``GroupInvitation.accepted`` の三値 (null/True/False) 状態遷移

サービス層の不変条件 (direct=2 / group<=20、空メッセ拒否) は ``test_services.py`` 側で検証。
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.dm.models import (
    MESSAGE_BODY_MAX_LENGTH,
    DMRoom,
    DMRoomMembership,
    GroupInvitation,
    Message,
    MessageAttachment,
    MessageReadReceipt,
)
from apps.dm.tests._factories import make_message, make_room, make_user


class DMRoomTests(TestCase):
    """DMRoom: kind / creator / last_message_at / index."""

    def test_create_direct_room_with_blank_name(self) -> None:
        room = DMRoom.objects.create(kind=DMRoom.Kind.DIRECT)
        self.assertEqual(room.kind, "direct")
        self.assertEqual(room.name, "")
        self.assertIsNone(room.last_message_at)
        self.assertIsNone(room.creator)

    def test_create_group_room_with_creator(self) -> None:
        creator = make_user()
        room = DMRoom.objects.create(kind=DMRoom.Kind.GROUP, name="Team A", creator=creator)
        self.assertEqual(room.kind, "group")
        self.assertEqual(room.name, "Team A")
        self.assertEqual(room.creator_id, creator.pk)

    def test_invalid_kind_raises_validation_error(self) -> None:
        room = DMRoom(kind="broadcast")  # 未定義 choice
        with self.assertRaises(ValidationError) as ctx:
            room.full_clean()
        self.assertIn("kind", ctx.exception.message_dict)

    def test_creator_set_null_on_user_delete(self) -> None:
        creator = make_user()
        room = DMRoom.objects.create(kind=DMRoom.Kind.GROUP, name="x", creator=creator)
        creator.delete()
        room.refresh_from_db()
        self.assertIsNone(room.creator)


class DMRoomMembershipTests(TestCase):
    """Membership: unique(room,user) + CASCADE 連鎖."""

    def test_unique_room_user_constraint(self) -> None:
        room = make_room()
        user = make_user()
        DMRoomMembership.objects.create(room=room, user=user)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DMRoomMembership.objects.create(room=room, user=user)

    def test_cascade_when_room_deleted(self) -> None:
        room = make_room()
        user = make_user()
        DMRoomMembership.objects.create(room=room, user=user)
        room.delete()
        self.assertFalse(DMRoomMembership.objects.filter(user=user).exists())

    def test_cascade_when_user_deleted(self) -> None:
        room = make_room()
        user = make_user()
        DMRoomMembership.objects.create(room=room, user=user)
        user.delete()
        self.assertFalse(DMRoomMembership.objects.filter(room=room).exists())


class MessageTests(TestCase):
    """Message: body 上限 / sender SET_NULL / room CASCADE / index."""

    def test_body_within_limit_is_valid(self) -> None:
        room = make_room()
        sender = make_user()
        msg = Message(room=room, sender=sender, body="x" * MESSAGE_BODY_MAX_LENGTH)
        msg.full_clean()  # 例外が出ないこと

    def test_body_over_limit_raises(self) -> None:
        room = make_room()
        sender = make_user()
        msg = Message(room=room, sender=sender, body="x" * (MESSAGE_BODY_MAX_LENGTH + 1))
        with self.assertRaises(ValidationError) as ctx:
            msg.full_clean()
        self.assertIn("body", ctx.exception.message_dict)

    def test_sender_set_null_on_user_delete(self) -> None:
        room = make_room()
        sender = make_user()
        msg = Message.objects.create(room=room, sender=sender, body="bye")
        sender.delete()
        msg.refresh_from_db()
        self.assertIsNone(msg.sender)

    def test_cascade_when_room_deleted(self) -> None:
        room = make_room()
        msg = make_message(room)
        msg_pk = msg.pk
        room.delete()
        self.assertFalse(Message.objects.filter(pk=msg_pk).exists())


class MessageAttachmentTests(TestCase):
    """MessageAttachment: s3_key を CharField で保持 (Issue P3-01)。"""

    def test_attachment_stores_s3_key_as_charfield(self) -> None:
        room = make_room()
        msg = make_message(room)
        attachment = MessageAttachment.objects.create(
            message=msg,
            s3_key=f"dm/{room.pk}/2026/05/abc123.jpg",
            filename="photo.jpg",
            mime_type="image/jpeg",
            size=2048,
            width=1024,
            height=768,
        )
        self.assertEqual(attachment.s3_key, f"dm/{room.pk}/2026/05/abc123.jpg")
        # FileField ではなく CharField なので storage を参照しない
        self.assertNotIn("file", [f.name for f in MessageAttachment._meta.get_fields()])

    def test_attachment_size_must_be_non_negative(self) -> None:
        room = make_room()
        msg = make_message(room)
        attachment = MessageAttachment(
            message=msg,
            s3_key=f"dm/{room.pk}/2026/05/x.jpg",
            filename="x.jpg",
            mime_type="image/jpeg",
            size=-1,
        )
        with self.assertRaises(ValidationError) as ctx:
            attachment.full_clean()
        self.assertIn("size", ctx.exception.message_dict)

    def test_attachment_cascade_on_message_delete(self) -> None:
        room = make_room()
        msg = make_message(room)
        attachment = MessageAttachment.objects.create(
            message=msg,
            s3_key="dm/x/2026/05/y.jpg",
            filename="y.jpg",
            mime_type="image/jpeg",
            size=100,
        )
        msg.delete()
        self.assertFalse(MessageAttachment.objects.filter(pk=attachment.pk).exists())


class MessageReadReceiptTests(TestCase):
    """MessageReadReceipt: Phase 3 ではビジネスロジック未使用、定義のみ。"""

    def test_receipt_unique_constraint(self) -> None:
        room = make_room()
        msg = make_message(room)
        user = make_user()
        MessageReadReceipt.objects.create(message=msg, user=user)
        with self.assertRaises(IntegrityError), transaction.atomic():
            MessageReadReceipt.objects.create(message=msg, user=user)


class GroupInvitationTests(TestCase):
    """GroupInvitation: accepted の三値 (null/True/False) と unique。"""

    def test_unique_room_invitee_constraint(self) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        inviter = make_user()
        invitee = make_user()
        GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
        with self.assertRaises(IntegrityError), transaction.atomic():
            GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)

    def test_accepted_state_transitions(self) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        inviter = make_user()
        invitee = make_user()
        invitation = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
        # 初期: 未応答 (null)
        self.assertIsNone(invitation.accepted)
        self.assertIsNone(invitation.responded_at)

        # 承諾
        invitation.accepted = True
        invitation.full_clean()
        invitation.save()
        invitation.refresh_from_db()
        self.assertTrue(invitation.accepted)

    def test_declined_state(self) -> None:
        """3 値のうち accepted=False (拒否) も保存できる (python-reviewer MEDIUM)."""
        room = make_room(kind=DMRoom.Kind.GROUP)
        invitation = GroupInvitation.objects.create(
            room=room, inviter=make_user(), invitee=make_user()
        )
        invitation.accepted = False
        invitation.full_clean()
        invitation.save()
        invitation.refresh_from_db()
        self.assertFalse(invitation.accepted)
        self.assertIsNotNone(invitation.accepted)  # null ではない

    def test_inviter_set_null_on_user_delete(self) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        inviter = make_user()
        invitee = make_user()
        invitation = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
        inviter.delete()
        invitation.refresh_from_db()
        self.assertIsNone(invitation.inviter)
