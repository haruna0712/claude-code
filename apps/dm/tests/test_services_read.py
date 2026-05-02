"""``apps.dm.services`` の既読関連テスト (P3-05 / Issue #230)."""

from __future__ import annotations

import pytest
from django.core.exceptions import PermissionDenied, ValidationError

from apps.dm.models import DMRoom, DMRoomMembership
from apps.dm.services import (
    annotate_rooms_with_unread_count,
    create_group_room,
    get_unread_count_for_room,
    mark_room_read,
)
from apps.dm.tests._factories import make_message, make_user

pytestmark = pytest.mark.django_db


def _setup_group_with_two_members():
    """creator + invitee + accepted membership 構成の group room."""
    creator = make_user()
    other = make_user()
    room = create_group_room(creator=creator, name="g")
    DMRoomMembership.objects.create(room=room, user=other)
    return room, creator, other


class TestMarkRoomRead:
    def test_updates_last_read_at_to_message_created_at(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        msg = make_message(room=room, sender=creator)

        membership = mark_room_read(room=room, user=other, message=msg)
        assert membership.last_read_at == msg.created_at

    def test_message_in_other_room_is_rejected(self) -> None:
        room, _, other = _setup_group_with_two_members()
        other_room, _, _ = _setup_group_with_two_members()
        msg = make_message(room=other_room)

        with pytest.raises(ValidationError):
            mark_room_read(room=room, user=other, message=msg)

    def test_non_member_is_rejected(self) -> None:
        room, _, _ = _setup_group_with_two_members()
        outsider = make_user()
        msg = make_message(room=room)

        with pytest.raises(PermissionDenied):
            mark_room_read(room=room, user=outsider, message=msg)

    def test_idempotent_on_older_message(self) -> None:
        """新しい既読位置 → 古い message は no-op (巻き戻し禁止).

        ``auto_now_add`` の sub-ms 解像度で 2 件が同時刻になる可能性があるため、
        ``freezegun`` で明示的に 1 秒空ける (review MEDIUM 反映)。
        """
        from datetime import timedelta

        from freezegun import freeze_time

        room, creator, other = _setup_group_with_two_members()
        with freeze_time("2026-05-01 00:00:00"):
            old_msg = make_message(room=room, sender=creator)
        with freeze_time("2026-05-01 00:00:01"):
            new_msg = make_message(room=room, sender=creator)

        assert new_msg.created_at - old_msg.created_at >= timedelta(seconds=1)

        mark_room_read(room=room, user=other, message=new_msg)
        membership = mark_room_read(room=room, user=other, message=old_msg)
        assert membership.last_read_at == new_msg.created_at


class TestUnreadCount:
    def test_counts_messages_after_last_read_at(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        # last_read_at を None のまま (= 全件未読)
        for _ in range(3):
            make_message(room=room, sender=creator)
        assert get_unread_count_for_room(room=room, user=other) == 3

    def test_excludes_own_messages(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        # other 自身が送ったメッセージは未読カウント対象外
        for _ in range(2):
            make_message(room=room, sender=other)
        # creator が送ったのは 1 件
        make_message(room=room, sender=creator)
        assert get_unread_count_for_room(room=room, user=other) == 1

    def test_excludes_deleted_messages(self) -> None:
        from django.utils import timezone

        room, creator, other = _setup_group_with_two_members()
        msg = make_message(room=room, sender=creator)
        msg.deleted_at = timezone.now()
        msg.save(update_fields=["deleted_at", "updated_at"])
        assert get_unread_count_for_room(room=room, user=other) == 0

    def test_zero_after_marking_read(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        for _ in range(3):
            make_message(room=room, sender=creator)
        last_msg = make_message(room=room, sender=creator)

        mark_room_read(room=room, user=other, message=last_msg)
        assert get_unread_count_for_room(room=room, user=other) == 0

    def test_non_member_is_zero(self) -> None:
        room, creator, _ = _setup_group_with_two_members()
        outsider = make_user()
        for _ in range(5):
            make_message(room=room, sender=creator)
        assert get_unread_count_for_room(room=room, user=outsider) == 0


class TestAnnotateRoomsWithUnreadCount:
    def test_inline_unread_count_for_rooms_list(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        for _ in range(2):
            make_message(room=room, sender=creator)

        rooms_qs = DMRoom.objects.filter(memberships__user=other).distinct()
        annotated = list(annotate_rooms_with_unread_count(rooms_qs, other))

        assert len(annotated) == 1
        assert annotated[0].unread_count == 2

    def test_room_with_no_messages_has_zero(self) -> None:
        room, _, other = _setup_group_with_two_members()
        rooms_qs = DMRoom.objects.filter(memberships__user=other).distinct()
        annotated = list(annotate_rooms_with_unread_count(rooms_qs, other))
        assert annotated[0].unread_count == 0

    def test_annotation_excludes_own_and_deleted(self) -> None:
        from django.utils import timezone

        room, creator, other = _setup_group_with_two_members()
        # other が送ったもの: 除外
        make_message(room=room, sender=other)
        # creator が送って削除されたもの: 除外
        deleted = make_message(room=room, sender=creator)
        deleted.deleted_at = timezone.now()
        deleted.save(update_fields=["deleted_at", "updated_at"])
        # creator が送った生きているもの: カウント対象 (1)
        make_message(room=room, sender=creator)

        rooms_qs = DMRoom.objects.filter(memberships__user=other).distinct()
        annotated = list(annotate_rooms_with_unread_count(rooms_qs, other))
        assert annotated[0].unread_count == 1

    def test_partial_read_counts_only_unread(self) -> None:
        """3 件中 2 件読んだ状態で annotation が 1 を返す (review database MEDIUM 反映)."""
        from freezegun import freeze_time

        room, creator, other = _setup_group_with_two_members()
        with freeze_time("2026-05-01 00:00:00"):
            make_message(room=room, sender=creator)
        with freeze_time("2026-05-01 00:00:01"):
            msg2 = make_message(room=room, sender=creator)
        with freeze_time("2026-05-01 00:00:02"):
            make_message(room=room, sender=creator)

        # msg2 まで既読 → 残 1 件 (msg3) が未読
        mark_room_read(room=room, user=other, message=msg2)

        rooms_qs = DMRoom.objects.filter(memberships__user=other).distinct()
        annotated = list(annotate_rooms_with_unread_count(rooms_qs, other))
        assert annotated[0].unread_count == 1
