"""``apps.dm.services`` の room/invitation/leave テスト (P3-04 / Issue #229)."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core.exceptions import PermissionDenied, ValidationError

from apps.dm.models import (
    DMRoom,
    DMRoomMembership,
    GroupInvitation,
)
from apps.dm.services import (
    accept_invitation,
    create_group_room,
    decline_invitation,
    get_or_create_direct_room,
    invite_user_to_room,
    leave_room,
)
from apps.dm.tests._factories import make_user

pytestmark = pytest.mark.django_db


class TestGetOrCreateDirectRoom:
    def test_creates_new_direct_room(self) -> None:
        a = make_user()
        b = make_user()
        room, created = get_or_create_direct_room(a, b)
        assert created is True
        assert room.kind == DMRoom.Kind.DIRECT
        assert DMRoomMembership.objects.filter(room=room).count() == 2

    def test_returns_existing_direct_room_idempotent(self) -> None:
        a = make_user()
        b = make_user()
        first, _ = get_or_create_direct_room(a, b)
        second, created = get_or_create_direct_room(a, b)
        assert created is False
        assert first.pk == second.pk

    def test_returns_existing_room_regardless_of_arg_order(self) -> None:
        a = make_user()
        b = make_user()
        first, _ = get_or_create_direct_room(a, b)
        second, created = get_or_create_direct_room(b, a)
        assert created is False
        assert first.pk == second.pk

    def test_self_dm_is_rejected(self) -> None:
        a = make_user()
        with pytest.raises(ValidationError):
            get_or_create_direct_room(a, a)

    def test_blocked_relationship_is_rejected(self) -> None:
        a = make_user()
        b = make_user()
        with (
            patch("apps.dm.integrations.moderation.is_dm_blocked", return_value=True),
            pytest.raises(PermissionDenied),
        ):
            get_or_create_direct_room(a, b)


class TestCreateGroupRoom:
    def test_creates_group_room_with_creator_as_member(self) -> None:
        creator = make_user()
        room = create_group_room(creator=creator, name="Team A")
        assert room.kind == DMRoom.Kind.GROUP
        assert room.name == "Team A"
        assert room.creator_id == creator.pk
        assert DMRoomMembership.objects.filter(room=room, user=creator).exists()

    def test_creates_group_with_invitations(self) -> None:
        creator = make_user()
        u1 = make_user()
        u2 = make_user()
        room = create_group_room(
            creator=creator, name="g", invitee_handles=[u1.username, u2.username]
        )
        assert GroupInvitation.objects.filter(room=room).count() == 2

    def test_rejects_empty_name(self) -> None:
        creator = make_user()
        with pytest.raises(ValidationError):
            create_group_room(creator=creator, name="   ")

    def test_rejects_unknown_handle(self) -> None:
        creator = make_user()
        with pytest.raises(ValidationError):
            create_group_room(creator=creator, name="g", invitee_handles=["nope"])


class TestInviteUserToRoom:
    def setup_method(self) -> None:
        self.creator = make_user()
        self.invitee = make_user()
        self.room = create_group_room(creator=self.creator, name="g")

    def test_creator_can_invite(self) -> None:
        invitation = invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        assert invitation.pk is not None
        assert invitation.accepted is None  # pending

    def test_non_creator_is_rejected(self) -> None:
        outsider = make_user()
        with pytest.raises(PermissionDenied):
            invite_user_to_room(room=self.room, inviter=outsider, invitee=self.invitee)

    def test_self_invite_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.creator)

    def test_direct_room_cannot_be_invited(self) -> None:
        a = make_user()
        b = make_user()
        direct, _ = get_or_create_direct_room(a, b)
        with pytest.raises(ValidationError):
            invite_user_to_room(room=direct, inviter=a, invitee=make_user())

    def test_existing_member_returns_validation_error(self) -> None:
        invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        # 承諾して member にしてから再招待 → 409 (ValidationError)
        membership = DMRoomMembership.objects.create(room=self.room, user=self.invitee)
        assert membership.pk is not None
        with pytest.raises(ValidationError):
            invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)

    def test_pending_invitation_is_idempotent(self) -> None:
        first = invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        second = invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        assert first.pk == second.pk

    def test_declined_invitation_can_be_reinvited(self) -> None:
        first = invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        decline_invitation(invitation=first, user=self.invitee)
        # 再招待: 旧 invitation は削除されて新規作成 (SPEC §A13)
        second = invite_user_to_room(room=self.room, inviter=self.creator, invitee=self.invitee)
        assert second.pk != first.pk
        assert second.accepted is None

    def test_20_member_limit_enforced(self) -> None:
        """member + pending invitation の合計が 20 を超えると 400."""
        # 既に creator が 1 名 → あと 19 まで招待可能
        invitees = [make_user() for _ in range(19)]
        for u in invitees:
            invite_user_to_room(room=self.room, inviter=self.creator, invitee=u)
        # 20 人目 (member 1 + invite 19 = 20) を 1 人加えると上限超過
        extra = make_user()
        with pytest.raises(ValidationError):
            invite_user_to_room(room=self.room, inviter=self.creator, invitee=extra)


class TestAcceptInvitation:
    def setup_method(self) -> None:
        self.creator = make_user()
        self.invitee = make_user()
        self.room = create_group_room(creator=self.creator, name="g")
        self.invitation = invite_user_to_room(
            room=self.room, inviter=self.creator, invitee=self.invitee
        )

    def test_invitee_can_accept(self) -> None:
        accept_invitation(invitation=self.invitation, user=self.invitee)
        self.invitation.refresh_from_db()
        assert self.invitation.accepted is True
        assert DMRoomMembership.objects.filter(room=self.room, user=self.invitee).exists()

    def test_non_invitee_is_rejected(self) -> None:
        outsider = make_user()
        with pytest.raises(PermissionDenied):
            accept_invitation(invitation=self.invitation, user=outsider)

    def test_double_accept_is_rejected(self) -> None:
        accept_invitation(invitation=self.invitation, user=self.invitee)
        with pytest.raises(ValidationError):
            accept_invitation(invitation=self.invitation, user=self.invitee)


class TestDeclineInvitation:
    def test_invitee_can_decline_and_inviter_does_not_get_notified(self) -> None:
        creator = make_user()
        invitee = make_user()
        room = create_group_room(creator=creator, name="g")
        invitation = invite_user_to_room(room=room, inviter=creator, invitee=invitee)

        with patch("apps.dm.integrations.notifications.emit_dm_invite") as mock_emit:
            decline_invitation(invitation=invitation, user=invitee)

        invitation.refresh_from_db()
        assert invitation.accepted is False
        # SPEC §A13: 拒否は inviter に通知しない
        mock_emit.assert_not_called()


class TestLeaveRoom:
    def test_member_can_leave_group_room(self) -> None:
        creator = make_user()
        member = make_user()
        room = create_group_room(creator=creator, name="g")
        DMRoomMembership.objects.create(room=room, user=member)

        leave_room(room=room, user=member)
        assert not DMRoomMembership.objects.filter(room=room, user=member).exists()

    def test_creator_leaving_transfers_creator_to_oldest_member(self) -> None:
        creator = make_user()
        m1 = make_user()
        m2 = make_user()
        room = create_group_room(creator=creator, name="g")
        DMRoomMembership.objects.create(room=room, user=m1)
        DMRoomMembership.objects.create(room=room, user=m2)

        leave_room(room=room, user=creator)
        room.refresh_from_db()
        # creator は m1 に移譲 (最古の member)
        assert room.creator_id == m1.pk

    def test_creator_leaving_empty_room_archives_it(self) -> None:
        creator = make_user()
        room = create_group_room(creator=creator, name="g")
        leave_room(room=room, user=creator)
        room.refresh_from_db()
        assert room.is_archived is True
        assert room.creator_id is None

    def test_direct_room_cannot_be_left(self) -> None:
        a = make_user()
        b = make_user()
        room, _ = get_or_create_direct_room(a, b)
        with pytest.raises(ValidationError):
            leave_room(room=room, user=a)

    def test_non_member_leave_raises(self) -> None:
        creator = make_user()
        outsider = make_user()
        room = create_group_room(creator=creator, name="g")
        with pytest.raises(ValidationError):
            leave_room(room=room, user=outsider)
