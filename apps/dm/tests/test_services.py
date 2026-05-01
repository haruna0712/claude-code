"""DM サービス層の単体テスト (P3-01 / Issue #226)。

DB 制約では表現できないビジネスルールをサービス層で検査する:

- ``DMRoom.kind=direct`` の room は **常に member 数 = 2** (3 件目は弾く)
- ``DMRoom.kind=group`` の room は **member 数 <= 20** (SPEC §7.1、21 件目は弾く)
- ``Message`` は ``body`` と ``attachments`` の **少なくとも 1 つが必要** (空送信不可)

これらは P3-03 (Consumer) や P3-04 (招待 API) 実装時に呼び出される前提で、
モデル単体ではなくサービス層に集約する設計。
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.test import TestCase

from apps.dm.models import (
    DMRoom,
    DMRoomMembership,
    Message,
    MessageAttachment,
)
from apps.dm.services import (
    GROUP_MEMBER_LIMIT,
    add_member_to_room,
    validate_message_payload,
)
from apps.dm.tests._factories import make_room, make_user


class DirectRoomMembershipServiceTests(TestCase):
    """direct room は 2 名固定。"""

    def test_allows_first_two_members(self) -> None:
        room = make_room(kind=DMRoom.Kind.DIRECT)
        u1 = make_user()
        u2 = make_user()

        m1 = add_member_to_room(room, u1)
        m2 = add_member_to_room(room, u2)

        self.assertIsNotNone(m1.pk)
        self.assertIsNotNone(m2.pk)
        self.assertEqual(DMRoomMembership.objects.filter(room=room).count(), 2)

    def test_rejects_third_member(self) -> None:
        room = make_room(kind=DMRoom.Kind.DIRECT)
        u1 = make_user()
        u2 = make_user()
        u3 = make_user()
        add_member_to_room(room, u1)
        add_member_to_room(room, u2)

        with self.assertRaises(ValidationError) as ctx:
            add_member_to_room(room, u3)
        # message にルール理由が含まれること
        self.assertIn("direct", str(ctx.exception).lower())

    def test_rejects_duplicate_member(self) -> None:
        """direct room で同じ user を 2 回追加するのも拒否 (unique 制約)."""
        room = make_room(kind=DMRoom.Kind.DIRECT)
        u1 = make_user()
        add_member_to_room(room, u1)

        with self.assertRaises(ValidationError):
            add_member_to_room(room, u1)


class GroupRoomMembershipServiceTests(TestCase):
    """group room は最大 20 名 (SPEC §7.1)."""

    def test_allows_up_to_limit(self) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        for _ in range(GROUP_MEMBER_LIMIT):
            add_member_to_room(room, make_user())
        self.assertEqual(
            DMRoomMembership.objects.filter(room=room).count(),
            GROUP_MEMBER_LIMIT,
        )

    def test_rejects_member_over_limit(self) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        for _ in range(GROUP_MEMBER_LIMIT):
            add_member_to_room(room, make_user())

        with self.assertRaises(ValidationError) as ctx:
            add_member_to_room(room, make_user())
        self.assertIn(str(GROUP_MEMBER_LIMIT), str(ctx.exception))


class ValidateMessagePayloadTests(TestCase):
    """空メッセージ (body 空 + attachments 0) を弾く."""

    def test_rejects_empty_body_and_no_attachments(self) -> None:
        with self.assertRaises(ValidationError) as ctx:
            validate_message_payload(body="", attachment_count=0)
        self.assertIn("空", str(ctx.exception))

    def test_accepts_body_only(self) -> None:
        # 例外を投げないこと
        validate_message_payload(body="hi", attachment_count=0)

    def test_accepts_attachment_only(self) -> None:
        validate_message_payload(body="", attachment_count=1)

    def test_accepts_both(self) -> None:
        validate_message_payload(body="caption", attachment_count=2)

    def test_rejects_whitespace_only_body(self) -> None:
        """空白のみの body も「空」扱い."""
        with self.assertRaises(ValidationError):
            validate_message_payload(body="   \n\t  ", attachment_count=0)

    def test_rejects_none_body_and_no_attachments(self) -> None:
        """body=None も空扱い (Consumer から来る dict.get の挙動を想定)."""
        with self.assertRaises(ValidationError):
            validate_message_payload(body=None, attachment_count=0)

    def test_rejects_negative_attachment_count(self) -> None:
        """負の attachment_count はプログラマエラーとして ValueError."""
        with self.assertRaises(ValueError):
            validate_message_payload(body="hi", attachment_count=-1)


class IntegrationWithMessageCreateTests(TestCase):
    """サービス層と Message.objects.create を組み合わせた統合確認."""

    def test_create_message_with_attachment_after_validation(self) -> None:
        room = make_room()
        sender = make_user()
        # サービス層で validation 済み前提
        validate_message_payload(body="", attachment_count=1)

        msg = Message.objects.create(room=room, sender=sender, body="")
        MessageAttachment.objects.create(
            message=msg,
            s3_key=f"dm/{room.pk}/2026/05/img.jpg",
            filename="img.jpg",
            mime_type="image/jpeg",
            size=512,
        )

        self.assertEqual(msg.attachments.count(), 1)
