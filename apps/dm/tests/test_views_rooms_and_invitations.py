"""DM Room / Invitation REST API の統合テスト (P3-04 / Issue #229)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.dm.models import DMRoom, DMRoomMembership, GroupInvitation
from apps.dm.services import create_group_room, invite_user_to_room
from apps.dm.tests._factories import make_user

pytestmark = pytest.mark.django_db


def _api(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class TestRoomListCreate:
    def test_unauthenticated_returns_401(self) -> None:
        response = _api().get("/api/v1/dm/rooms/")
        assert response.status_code == 401

    def test_list_only_my_rooms(self) -> None:
        u = make_user()
        other = make_user()
        room_a = create_group_room(creator=u, name="A")
        room_b = create_group_room(creator=other, name="B")  # 自分が member でない
        response = _api(u).get("/api/v1/dm/rooms/")
        assert response.status_code == 200
        room_ids = (
            [r["id"] for r in response.json()["results"]]
            if "results" in response.json()
            else [r["id"] for r in response.json()]
        )
        assert room_a.pk in room_ids
        assert room_b.pk not in room_ids

    def test_create_direct_room(self) -> None:
        u = make_user()
        peer = make_user()
        response = _api(u).post(
            "/api/v1/dm/rooms/",
            {"kind": "direct", "member_handle": peer.username},
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["kind"] == "direct"

    def test_create_direct_room_idempotent_returns_200(self) -> None:
        u = make_user()
        peer = make_user()
        _api(u).post(
            "/api/v1/dm/rooms/",
            {"kind": "direct", "member_handle": peer.username},
            format="json",
        )
        response2 = _api(u).post(
            "/api/v1/dm/rooms/",
            {"kind": "direct", "member_handle": peer.username},
            format="json",
        )
        # idempotent: 2 回目は 200 (既存 room を返す)
        assert response2.status_code == 200

    def test_create_group_room(self) -> None:
        u = make_user()
        invitee = make_user()
        response = _api(u).post(
            "/api/v1/dm/rooms/",
            {"kind": "group", "name": "Team A", "invitee_handles": [invitee.username]},
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["kind"] == "group"
        assert response.json()["name"] == "Team A"
        # 招待が 1 件生成されている
        room_id = response.json()["id"]
        assert GroupInvitation.objects.filter(room_id=room_id, invitee=invitee).count() == 1

    def test_invalid_kind_returns_400(self) -> None:
        u = make_user()
        response = _api(u).post(
            "/api/v1/dm/rooms/",
            {"kind": "broadcast"},
            format="json",
        )
        assert response.status_code == 400


class TestRoomDetailAndMessages:
    def test_member_can_view_room_detail(self) -> None:
        u = make_user()
        room = create_group_room(creator=u, name="g")
        response = _api(u).get(f"/api/v1/dm/rooms/{room.pk}/")
        assert response.status_code == 200
        assert response.json()["id"] == room.pk

    def test_non_member_gets_404(self) -> None:
        u = make_user()
        outsider = make_user()
        room = create_group_room(creator=u, name="g")
        response = _api(outsider).get(f"/api/v1/dm/rooms/{room.pk}/")
        assert response.status_code == 404

    def test_messages_endpoint_returns_recent_messages(self) -> None:
        from apps.dm.models import Message

        u = make_user()
        room = create_group_room(creator=u, name="g")
        for i in range(5):
            Message.objects.create(room=room, sender=u, body=f"msg {i}")
        response = _api(u).get(f"/api/v1/dm/rooms/{room.pk}/messages/")
        assert response.status_code == 200
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        assert len(results) == 5


class TestRoomInvitations:
    def test_creator_can_invite(self) -> None:
        creator = make_user()
        invitee = make_user()
        room = create_group_room(creator=creator, name="g")
        response = _api(creator).post(
            f"/api/v1/dm/rooms/{room.pk}/invitations/",
            {"invitee_handle": invitee.username},
            format="json",
        )
        assert response.status_code == 201
        assert response.json()["invitee_id"] == invitee.pk

    def test_non_creator_gets_404(self) -> None:
        creator = make_user()
        outsider = make_user()
        room = create_group_room(creator=creator, name="g")
        response = _api(outsider).post(
            f"/api/v1/dm/rooms/{room.pk}/invitations/",
            {"invitee_handle": "anyone"},
            format="json",
        )
        # creator 以外は room の存在自体を 404 で隠す
        assert response.status_code == 404


class TestInvitationLifecycle:
    def test_pending_invitations_listed(self) -> None:
        creator = make_user()
        invitee = make_user()
        room = create_group_room(creator=creator, name="g")
        invite_user_to_room(room=room, inviter=creator, invitee=invitee)

        response = _api(invitee).get("/api/v1/dm/invitations/")
        assert response.status_code == 200
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        assert len(results) == 1

    def test_invitation_serializer_includes_flat_handles_and_room_name(self) -> None:
        """frontend `InvitationList` が `inviter_handle` / `room_name` を直接読むため
        nested object ではなく flat に出ることを保証する (#276 type drift fix)."""
        creator = make_user(username="alice_inviter")
        invitee = make_user(username="bob_invitee")
        room = create_group_room(creator=creator, name="phase3-test-group")
        invite_user_to_room(room=room, inviter=creator, invitee=invitee)

        response = _api(invitee).get("/api/v1/dm/invitations/")
        assert response.status_code == 200
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        assert len(results) == 1
        inv = results[0]

        # flat fields (旧 nested は frontend で undefined access を起こしていた)
        assert inv["inviter_id"] == creator.pk
        assert inv["inviter_handle"] == "alice_inviter"
        assert inv["invitee_id"] == invitee.pk
        assert inv["invitee_handle"] == "bob_invitee"
        assert inv["room_id"] == room.pk
        assert inv["room_name"] == "phase3-test-group"
        # nested object は存在しない (back-compat の保証も兼ねる)
        assert "inviter" not in inv
        assert "invitee" not in inv
        assert "room" not in inv

    def test_accept_creates_membership(self) -> None:
        creator = make_user()
        invitee = make_user()
        room = create_group_room(creator=creator, name="g")
        invitation = invite_user_to_room(room=room, inviter=creator, invitee=invitee)
        response = _api(invitee).post(f"/api/v1/dm/invitations/{invitation.pk}/accept/")
        assert response.status_code == 200
        assert DMRoomMembership.objects.filter(room=room, user=invitee).exists()

    def test_decline_marks_accepted_false(self) -> None:
        creator = make_user()
        invitee = make_user()
        room = create_group_room(creator=creator, name="g")
        invitation = invite_user_to_room(room=room, inviter=creator, invitee=invitee)
        response = _api(invitee).post(f"/api/v1/dm/invitations/{invitation.pk}/decline/")
        assert response.status_code == 200
        invitation.refresh_from_db()
        assert invitation.accepted is False

    def test_other_user_cannot_act_on_invitation(self) -> None:
        creator = make_user()
        invitee = make_user()
        outsider = make_user()
        room = create_group_room(creator=creator, name="g")
        invitation = invite_user_to_room(room=room, inviter=creator, invitee=invitee)
        response = _api(outsider).post(f"/api/v1/dm/invitations/{invitation.pk}/accept/")
        # 他人宛の招待は 404 で隠す
        assert response.status_code == 404


class TestMembershipDelete:
    def test_member_can_leave_group(self) -> None:
        creator = make_user()
        member = make_user()
        room = create_group_room(creator=creator, name="g")
        DMRoomMembership.objects.create(room=room, user=member)

        response = _api(member).delete(f"/api/v1/dm/rooms/{room.pk}/membership/")
        assert response.status_code == 204
        assert not DMRoomMembership.objects.filter(room=room, user=member).exists()

    def test_non_member_gets_404(self) -> None:
        creator = make_user()
        outsider = make_user()
        room = create_group_room(creator=creator, name="g")
        response = _api(outsider).delete(f"/api/v1/dm/rooms/{room.pk}/membership/")
        assert response.status_code == 404

    def test_direct_room_cannot_be_left(self) -> None:
        a = make_user()
        b = make_user()
        # direct room を作る
        _api(a).post(
            "/api/v1/dm/rooms/",
            {"kind": "direct", "member_handle": b.username},
            format="json",
        )
        room = DMRoom.objects.filter(kind=DMRoom.Kind.DIRECT).first()
        response = _api(a).delete(f"/api/v1/dm/rooms/{room.pk}/membership/")
        assert response.status_code == 400
