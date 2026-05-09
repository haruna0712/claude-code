"""apps.dm.services.confirm_attachment + send_message(attachment_ids=...) テスト.

P3-06 / Issue #231。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.core.exceptions import (
    PermissionDenied as DjangoPermissionDenied,
)
from django.core.exceptions import (
    ValidationError,
)

from apps.dm.models import MessageAttachment
from apps.dm.s3_presign import S3ObjectInfo
from apps.dm.services import confirm_attachment, send_message
from apps.dm.tests._factories import make_membership, make_room, make_user


def _patched_head(*, content_length: int, content_type: str = "image/jpeg"):
    return patch(
        "apps.dm.services._presign.head_object",
        return_value=S3ObjectInfo(content_length=content_length, content_type=content_type),
    )


@pytest.mark.django_db
def test_confirm_attachment_creates_orphan() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/abcd-ef.jpg"
    with _patched_head(content_length=1024):
        att = confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="photo.jpg",
            mime_type="image/jpeg",
            size=1024,
        )

    assert att.message_id is None
    assert att.room_id == room.pk
    assert att.uploaded_by_id == user.pk
    assert att.s3_key == s3_key


# Issue #459: width/height を保存するテスト群


@pytest.mark.django_db
def test_confirm_attachment_saves_width_height_for_image() -> None:
    """image MIME のとき client 計測の実寸を MessageAttachment に保存する."""
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/sized.png"
    with _patched_head(content_length=2048, content_type="image/png"):
        att = confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="sized.png",
            mime_type="image/png",
            size=2048,
            width=1296,
            height=952,
        )

    assert att.width == 1296
    assert att.height == 952


@pytest.mark.django_db
def test_confirm_attachment_ignores_dimensions_for_non_image() -> None:
    """non-image MIME (pdf 等) で width/height が来ても None に強制."""
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/doc.pdf"
    with _patched_head(content_length=512, content_type="application/pdf"):
        att = confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="doc.pdf",
            mime_type="application/pdf",
            size=512,
            width=100,  # 来てもよいが service 層で None になる
            height=100,
        )

    assert att.width is None
    assert att.height is None


@pytest.mark.django_db
def test_confirm_attachment_without_dimensions_is_backward_compatible() -> None:
    """既存呼び出し (width/height 未指定) も動作 (= 後方互換)."""
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/legacy.jpg"
    with _patched_head(content_length=2048):
        att = confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="legacy.jpg",
            mime_type="image/jpeg",
            size=2048,
        )

    assert att.width is None
    assert att.height is None


@pytest.mark.django_db
def test_confirm_attachment_rejects_wrong_room_prefix() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)
    other_room = make_room()

    s3_key = f"dm/{other_room.pk}/2026/05/abcd-ef.jpg"
    with (
        _patched_head(content_length=1024),
        pytest.raises(ValidationError, match="must start with"),
    ):
        confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="photo.jpg",
            mime_type="image/jpeg",
            size=1024,
        )


@pytest.mark.django_db
def test_confirm_attachment_rejects_size_mismatch() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/abcd-ef.jpg"
    with _patched_head(content_length=2048), pytest.raises(ValidationError, match="サイズ"):
        confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="photo.jpg",
            mime_type="image/jpeg",
            size=1024,
        )


@pytest.mark.django_db
def test_confirm_attachment_rejects_content_type_mismatch() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/abcd-ef.jpg"
    with (
        _patched_head(content_length=1024, content_type="application/pdf"),
        pytest.raises(ValidationError, match="Content-Type"),
    ):
        confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="photo.jpg",
            mime_type="image/jpeg",
            size=1024,
        )


@pytest.mark.django_db
def test_confirm_attachment_rejects_invalid_filename() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/abcd-ef.jpg"
    # head_object に到達する前に validate_attachment_request で path traversal を弾く。
    with pytest.raises(ValidationError):
        confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="../etc/passwd.jpg",
            mime_type="image/jpeg",
            size=1024,
        )


# ---------------------------------------------------------------------------
# send_message(attachment_ids=...)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_send_message_links_orphan_attachments() -> None:
    user = make_user()
    other = make_user()
    room = make_room()
    make_membership(room=room, user=user)
    make_membership(room=room, user=other)

    s3_key = f"dm/{room.pk}/2026/05/orphan.jpg"
    with _patched_head(content_length=10):
        att = confirm_attachment(
            user=user,
            room=room,
            s3_key=s3_key,
            filename="x.jpg",
            mime_type="image/jpeg",
            size=10,
        )

    msg = send_message(room=room, sender=user, body="see attached", attachment_ids=[att.pk])

    att.refresh_from_db()
    assert att.message_id == msg.pk


@pytest.mark.django_db
def test_send_message_attachment_ids_rejects_other_users_orphan() -> None:
    a = make_user()
    b = make_user()
    room = make_room()
    make_membership(room=room, user=a)
    make_membership(room=room, user=b)

    s3_key = f"dm/{room.pk}/2026/05/o.jpg"
    with _patched_head(content_length=10):
        att = confirm_attachment(
            user=a, room=room, s3_key=s3_key, filename="x.jpg", mime_type="image/jpeg", size=10
        )

    # b が a の orphan を奪おうとする
    with pytest.raises(DjangoPermissionDenied, match="他ユーザー"):
        send_message(room=room, sender=b, body="hi", attachment_ids=[att.pk])


@pytest.mark.django_db
def test_send_message_attachment_ids_rejects_other_room() -> None:
    user = make_user()
    room = make_room()
    other_room = make_room()
    make_membership(room=room, user=user)
    make_membership(room=other_room, user=user)

    s3_key = f"dm/{other_room.pk}/2026/05/o.jpg"
    with _patched_head(content_length=10):
        att = confirm_attachment(
            user=user,
            room=other_room,
            s3_key=s3_key,
            filename="x.jpg",
            mime_type="image/jpeg",
            size=10,
        )

    with pytest.raises(DjangoPermissionDenied, match="別 room"):
        send_message(room=room, sender=user, body="hi", attachment_ids=[att.pk])


@pytest.mark.django_db
def test_send_message_attachment_ids_rejects_unknown_id() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    with pytest.raises(ValidationError, match="一部が見つかりません"):
        send_message(room=room, sender=user, body="hi", attachment_ids=[99999])


@pytest.mark.django_db
def test_send_message_rejects_both_keys_and_ids() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    with pytest.raises(ValueError, match="両方"):
        send_message(
            room=room,
            sender=user,
            body="x",
            attachment_keys=[{"s3_key": f"dm/{room.pk}/foo.jpg"}],
            attachment_ids=[1],
        )


@pytest.mark.django_db
def test_send_message_attachment_ids_rejects_already_linked() -> None:
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    s3_key = f"dm/{room.pk}/2026/05/o.jpg"
    with _patched_head(content_length=10):
        att = confirm_attachment(
            user=user, room=room, s3_key=s3_key, filename="x.jpg", mime_type="image/jpeg", size=10
        )
    msg = send_message(room=room, sender=user, body="first", attachment_ids=[att.pk])
    att.refresh_from_db()
    assert att.message_id == msg.pk

    # 同じ attachment を再度紐付けようとすると orphan filter ですり抜けるため not found 扱い
    with pytest.raises(ValidationError, match="一部が見つかりません"):
        send_message(room=room, sender=user, body="second", attachment_ids=[att.pk])


@pytest.mark.django_db
def test_message_attachment_orphan_index_lookup_works() -> None:
    """orphan partial index が SELECT で実際に使われるか smoke check (functional)."""
    user = make_user()
    room = make_room()
    make_membership(room=room, user=user)

    with _patched_head(content_length=10):
        confirm_attachment(
            user=user,
            room=room,
            s3_key=f"dm/{room.pk}/2026/05/o.jpg",
            filename="x.jpg",
            mime_type="image/jpeg",
            size=10,
        )

    # filter による絞り込みが「orphan のみ」で動くこと。
    qs = MessageAttachment.objects.filter(message__isnull=True)
    assert qs.count() == 1
