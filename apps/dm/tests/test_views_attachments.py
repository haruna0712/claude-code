"""apps.dm.views の Presign / Confirm 添付 API 統合テスト (P3-06 / Issue #231).

REST 経由で:
- /api/v1/dm/attachments/presign/ → 200 + url/fields/s3_key
- /api/v1/dm/attachments/confirm/ → 201 + id (orphan 作成)
- 非メンバー / 不正 mime / size 超過は 400 / 404
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient

from apps.dm.s3_presign import S3ObjectInfo
from apps.dm.tests._factories import make_membership, make_room, make_user


def _client_for(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _fake_post_response(bucket: str, key: str) -> dict:
    return {
        "url": f"https://{bucket}.s3.ap-northeast-1.amazonaws.com/",
        "fields": {"key": key, "Content-Type": "image/jpeg"},
    }


@pytest.mark.django_db
def test_presign_view_returns_200_and_fields(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        build_client.return_value.generate_presigned_post.side_effect = (
            lambda **kw: _fake_post_response(kw["Bucket"], kw["Key"])
        )
        resp = _client_for(user).post(
            reverse("dm:attachment-presign"),
            {
                "room_id": room.pk,
                "filename": "photo.jpg",
                "mime_type": "image/jpeg",
                "size": 1024,
            },
            format="json",
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["url"].startswith("https://test-bucket.s3.")
    assert body["s3_key"].startswith(f"dm/{room.pk}/")
    assert "fields" in body
    assert "expires_at" in body


@pytest.mark.django_db
def test_presign_view_404_for_non_member() -> None:
    intruder = make_user()
    room = make_room()  # intruder is NOT a member

    resp = _client_for(intruder).post(
        reverse("dm:attachment-presign"),
        {
            "room_id": room.pk,
            "filename": "photo.jpg",
            "mime_type": "image/jpeg",
            "size": 1024,
        },
        format="json",
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_presign_view_400_for_unknown_mime() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    resp = _client_for(user).post(
        reverse("dm:attachment-presign"),
        {
            "room_id": room.pk,
            "filename": "photo.heic",
            "mime_type": "image/heic",
            "size": 1024,
        },
        format="json",
    )
    assert resp.status_code == 400
    assert "Unsupported mime_type" in resp.json()[0]


@pytest.mark.django_db
def test_presign_view_400_for_oversize() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    resp = _client_for(user).post(
        reverse("dm:attachment-presign"),
        {
            "room_id": room.pk,
            "filename": "huge.jpg",
            "mime_type": "image/jpeg",
            "size": 50 * 1024 * 1024,
        },
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_presign_view_401_for_unauthenticated() -> None:
    room = make_room()
    resp = APIClient().post(
        reverse("dm:attachment-presign"),
        {
            "room_id": room.pk,
            "filename": "photo.jpg",
            "mime_type": "image/jpeg",
            "size": 1024,
        },
        format="json",
    )
    assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Confirm
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_confirm_view_creates_orphan(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/abcd.jpg"
    with patch(
        "apps.dm.services._presign.head_object",
        return_value=S3ObjectInfo(content_length=2048, content_type="image/jpeg"),
    ):
        resp = _client_for(user).post(
            reverse("dm:attachment-confirm"),
            {
                "room_id": room.pk,
                "s3_key": s3_key,
                "filename": "photo.jpg",
                "mime_type": "image/jpeg",
                "size": 2048,
            },
            format="json",
        )

    assert resp.status_code == 201, resp.content
    body = resp.json()
    assert body["s3_key"] == s3_key
    assert body["filename"] == "photo.jpg"
    assert isinstance(body["id"], int)


@pytest.mark.django_db
def test_confirm_view_404_for_non_member() -> None:
    intruder = make_user()
    room = make_room()  # intruder NOT a member

    resp = _client_for(intruder).post(
        reverse("dm:attachment-confirm"),
        {
            "room_id": room.pk,
            "s3_key": f"dm/{room.pk}/2026/05/x.jpg",
            "filename": "x.jpg",
            "mime_type": "image/jpeg",
            "size": 100,
        },
        format="json",
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_confirm_view_400_when_s3_object_missing() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    from django.core.exceptions import ValidationError as DjangoVE

    with patch(
        "apps.dm.services._presign.head_object",
        side_effect=DjangoVE("object not found"),
    ):
        resp = _client_for(user).post(
            reverse("dm:attachment-confirm"),
            {
                "room_id": room.pk,
                "s3_key": f"dm/{room.pk}/2026/05/missing.jpg",
                "filename": "x.jpg",
                "mime_type": "image/jpeg",
                "size": 100,
            },
            format="json",
        )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_confirm_view_400_for_size_mismatch() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    with patch(
        "apps.dm.services._presign.head_object",
        return_value=S3ObjectInfo(content_length=999, content_type="image/jpeg"),
    ):
        resp = _client_for(user).post(
            reverse("dm:attachment-confirm"),
            {
                "room_id": room.pk,
                "s3_key": f"dm/{room.pk}/2026/05/x.jpg",
                "filename": "x.jpg",
                "mime_type": "image/jpeg",
                "size": 100,
            },
            format="json",
        )
    assert resp.status_code == 400
    assert "サイズ" in resp.content.decode()
