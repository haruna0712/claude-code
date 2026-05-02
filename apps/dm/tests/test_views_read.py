"""``POST /api/v1/dm/rooms/<id>/read/`` と room 一覧の ``unread_count`` の REST テスト (P3-05)."""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.dm.models import DMRoomMembership
from apps.dm.services import create_group_room
from apps.dm.tests._factories import make_message, make_user

pytestmark = pytest.mark.django_db


def _api(user=None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def _setup_group_with_two_members():
    creator = make_user()
    other = make_user()
    room = create_group_room(creator=creator, name="g")
    DMRoomMembership.objects.create(room=room, user=other)
    return room, creator, other


class TestRoomReadEndpoint:
    def test_updates_last_read_at_and_returns_200(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        msg = make_message(room=room, sender=creator)

        response = _api(other).post(
            f"/api/v1/dm/rooms/{room.pk}/read/",
            {"message_id": msg.pk},
            format="json",
        )
        assert response.status_code == 200
        body = response.json()
        assert body["room_id"] == room.pk
        assert body["user_id"] == other.pk
        assert body["last_read_at"] is not None

    def test_message_in_other_room_returns_400(self) -> None:
        room, _, other = _setup_group_with_two_members()
        other_room, other_creator, _ = _setup_group_with_two_members()
        foreign_msg = make_message(room=other_room, sender=other_creator)

        response = _api(other).post(
            f"/api/v1/dm/rooms/{room.pk}/read/",
            {"message_id": foreign_msg.pk},
            format="json",
        )
        assert response.status_code == 400

    def test_non_member_gets_404(self) -> None:
        room, creator, _ = _setup_group_with_two_members()
        outsider = make_user()
        msg = make_message(room=room, sender=creator)

        response = _api(outsider).post(
            f"/api/v1/dm/rooms/{room.pk}/read/",
            {"message_id": msg.pk},
            format="json",
        )
        assert response.status_code == 404

    def test_unauthenticated_returns_401(self) -> None:
        response = _api().post(
            "/api/v1/dm/rooms/1/read/",
            {"message_id": 1},
            format="json",
        )
        assert response.status_code == 401

    def test_missing_message_returns_400(self) -> None:
        room, _, other = _setup_group_with_two_members()
        response = _api(other).post(
            f"/api/v1/dm/rooms/{room.pk}/read/",
            {"message_id": 99999999},
            format="json",
        )
        assert response.status_code == 400


class TestRoomListUnreadCount:
    def test_unread_count_is_inline(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        # creator が 3 件送る
        for _ in range(3):
            make_message(room=room, sender=creator)

        response = _api(other).get("/api/v1/dm/rooms/")
        assert response.status_code == 200
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        target = next((r for r in results if r["id"] == room.pk), None)
        assert target is not None
        assert target["unread_count"] == 3

    def test_unread_count_drops_to_zero_after_read(self) -> None:
        room, creator, other = _setup_group_with_two_members()
        for _ in range(2):
            make_message(room=room, sender=creator)
        last_msg = make_message(room=room, sender=creator)

        # 既読 update
        post_resp = _api(other).post(
            f"/api/v1/dm/rooms/{room.pk}/read/",
            {"message_id": last_msg.pk},
            format="json",
        )
        assert post_resp.status_code == 200, post_resp.json()

        response = _api(other).get("/api/v1/dm/rooms/")
        body = response.json()
        results = body["results"] if isinstance(body, dict) and "results" in body else body
        target = next((r for r in results if r["id"] == room.pk), None)
        assert target["unread_count"] == 0
