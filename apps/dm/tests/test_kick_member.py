"""メンバー削除 (kick) のテスト (#492).

DELETE /api/v1/dm/rooms/<id>/members/<user_id>/
- 認証必須 (anonymous → 401/403)
- creator のみ kick 可、それ以外は 403
- direct room は kick 不可、400
- target=creator は不可、400
- target が member でない場合は 400
- 成功時 204 + DB から membership が消える
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.dm.models import DMRoom, DMRoomMembership

User = get_user_model()


def _make_user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _make_group_with_member(creator, member):
    room = DMRoom.objects.create(kind="group", name="g1", creator=creator)
    DMRoomMembership.objects.create(room=room, user=creator)
    DMRoomMembership.objects.create(room=room, user=member)
    return room


@pytest.fixture
def url():
    def _build(room_pk: int, user_pk: int) -> str:
        return reverse(
            "dm:room-member-kick",
            kwargs={"pk": room_pk, "user_id": user_pk},
        )

    return _build


@pytest.mark.django_db
def test_kick_requires_auth(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    resp = client.delete(url(room.pk, member.pk))
    assert resp.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )


@pytest.mark.django_db
def test_kick_by_creator_204_and_membership_removed(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    client.force_authenticate(user=creator)
    resp = client.delete(url(room.pk, member.pk))
    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert not DMRoomMembership.objects.filter(room=room, user=member).exists()
    # creator の membership は残る
    assert DMRoomMembership.objects.filter(room=room, user=creator).exists()


@pytest.mark.django_db
def test_kick_by_non_creator_returns_403(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    other = _make_user("carol")
    room = _make_group_with_member(creator, member)
    DMRoomMembership.objects.create(room=room, user=other)
    client = APIClient()
    client.force_authenticate(user=other)
    resp = client.delete(url(room.pk, member.pk))
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert DMRoomMembership.objects.filter(room=room, user=member).exists()


@pytest.mark.django_db
def test_kick_outsider_returns_404(url) -> None:
    """kicker が room メンバーでない → 404 (room 隠蔽)."""
    creator = _make_user("alice")
    member = _make_user("bob")
    outsider = _make_user("dave")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    client.force_authenticate(user=outsider)
    resp = client.delete(url(room.pk, member.pk))
    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_kick_creator_self_returns_400(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    client.force_authenticate(user=creator)
    resp = client.delete(url(room.pk, creator.pk))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    # creator membership はそのまま
    assert DMRoomMembership.objects.filter(room=room, user=creator).exists()


@pytest.mark.django_db
def test_kick_non_member_returns_400(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    not_member = _make_user("eve")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    client.force_authenticate(user=creator)
    resp = client.delete(url(room.pk, not_member.pk))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_kick_in_direct_room_returns_400(url) -> None:
    creator = _make_user("alice")
    other = _make_user("bob")
    room = DMRoom.objects.create(kind="direct", creator=creator)
    DMRoomMembership.objects.create(room=room, user=creator)
    DMRoomMembership.objects.create(room=room, user=other)
    client = APIClient()
    client.force_authenticate(user=creator)
    resp = client.delete(url(room.pk, other.pk))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_kick_unknown_user_returns_404(url) -> None:
    creator = _make_user("alice")
    member = _make_user("bob")
    room = _make_group_with_member(creator, member)
    client = APIClient()
    client.force_authenticate(user=creator)
    resp = client.delete(url(room.pk, 999999))
    assert resp.status_code == status.HTTP_404_NOT_FOUND
