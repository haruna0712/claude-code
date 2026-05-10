"""招待取消 (#481) のテスト.

DELETE /api/v1/dm/invitations/<id>/
- 認可: invitation.inviter のみ。それ以外は 404 (隠蔽)
- 状態: pending (accepted is None) のみ削除可、応答済みは 409
- 認証必須 (anonymous → 401)
- 成功時 204 + DB から消える
"""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.dm.models import DMRoom, DMRoomMembership, GroupInvitation

User = get_user_model()


def _make_user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _make_group(creator):
    room = DMRoom.objects.create(kind="group", name="g1", creator=creator)
    DMRoomMembership.objects.create(room=room, user=creator)
    return room


@pytest.fixture
def url():
    def _build(pk: int) -> str:
        return reverse("dm:invitation-cancel", kwargs={"pk": pk})

    return _build


@pytest.mark.django_db
def test_cancel_requires_auth(url) -> None:
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
    client = APIClient()
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.django_db
def test_cancel_by_inviter_success_204(url) -> None:
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
    client = APIClient()
    client.force_authenticate(user=inviter)
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_204_NO_CONTENT
    assert not GroupInvitation.objects.filter(pk=inv.pk).exists()


@pytest.mark.django_db
def test_cancel_by_invitee_returns_404(url) -> None:
    """invitee は inviter ではないので 404 (存在隠蔽)."""
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
    client = APIClient()
    client.force_authenticate(user=invitee)
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_404_NOT_FOUND
    assert GroupInvitation.objects.filter(pk=inv.pk).exists()


@pytest.mark.django_db
def test_cancel_by_third_party_returns_404(url) -> None:
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    other = _make_user("carol")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
    client = APIClient()
    client.force_authenticate(user=other)
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_cancel_accepted_returns_400(url) -> None:
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee, accepted=True)
    client = APIClient()
    client.force_authenticate(user=inviter)
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST
    assert GroupInvitation.objects.filter(pk=inv.pk).exists()


@pytest.mark.django_db
def test_cancel_declined_returns_400(url) -> None:
    inviter = _make_user("alice")
    invitee = _make_user("bob")
    room = _make_group(inviter)
    inv = GroupInvitation.objects.create(
        room=room, inviter=inviter, invitee=invitee, accepted=False
    )
    client = APIClient()
    client.force_authenticate(user=inviter)
    resp = client.delete(url(inv.pk))
    assert resp.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_cancel_not_found_for_unknown_pk(url) -> None:
    inviter = _make_user("alice")
    client = APIClient()
    client.force_authenticate(user=inviter)
    resp = client.delete(url(999999))
    assert resp.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
def test_list_as_inviter_returns_only_own_outgoing() -> None:
    """GET /invitations/?as=inviter で自分が送った pending のみ返ること."""
    me = _make_user("inviter")
    other_inviter = _make_user("other")
    invitee_a = _make_user("a")
    invitee_b = _make_user("b")
    room1 = _make_group(me)
    room2 = _make_group(other_inviter)

    GroupInvitation.objects.create(room=room1, inviter=me, invitee=invitee_a)
    GroupInvitation.objects.create(room=room1, inviter=me, invitee=invitee_b)
    GroupInvitation.objects.create(room=room2, inviter=other_inviter, invitee=me)

    client = APIClient()
    client.force_authenticate(user=me)
    resp = client.get("/api/v1/dm/invitations/?as=inviter")
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    handles = sorted(i["invitee_handle"] for i in data["results"])
    assert handles == ["a", "b"]
