"""apps.dm.serializers の url field 等のテスト (Issue #458)."""

from __future__ import annotations

import pytest

from apps.dm.serializers import MessageAttachmentSerializer
from apps.dm.tests._factories import make_message, make_room, make_user


@pytest.mark.django_db
def test_attachment_serializer_url_field_is_app_fqdn_plus_s3_key(settings) -> None:
    """`url` field = `DM_ATTACHMENT_BASE_URL` + `/` + `s3_key`."""
    settings.DM_ATTACHMENT_BASE_URL = "https://stg.codeplace.me"

    from apps.dm.models import MessageAttachment

    user = make_user()
    room = make_room()
    msg = make_message(room=room, sender=user, body="hi")
    att = MessageAttachment.objects.create(
        message=msg,
        room=room,
        uploaded_by=user,
        s3_key="dm/1/2026/05/abc.png",
        filename="abc.png",
        mime_type="image/png",
        size=1024,
        width=640,
        height=480,
    )

    data = MessageAttachmentSerializer(att).data
    assert data["url"] == "https://stg.codeplace.me/dm/1/2026/05/abc.png"
    assert data["width"] == 640
    assert data["height"] == 480


@pytest.mark.django_db
def test_attachment_serializer_url_strips_trailing_slash(settings) -> None:
    """base URL に trailing slash があっても二重スラッシュにしない."""
    settings.DM_ATTACHMENT_BASE_URL = "https://stg.codeplace.me/"

    from apps.dm.models import MessageAttachment

    user = make_user()
    room = make_room()
    msg = make_message(room=room, sender=user, body="hi")
    att = MessageAttachment.objects.create(
        message=msg,
        room=room,
        uploaded_by=user,
        s3_key="dm/1/2026/05/x.pdf",
        filename="x.pdf",
        mime_type="application/pdf",
        size=512,
    )

    data = MessageAttachmentSerializer(att).data
    assert data["url"] == "https://stg.codeplace.me/dm/1/2026/05/x.pdf"


@pytest.mark.django_db
def test_attachment_serializer_url_local_base(settings) -> None:
    settings.DM_ATTACHMENT_BASE_URL = "http://localhost:8080"

    from apps.dm.models import MessageAttachment

    user = make_user()
    room = make_room()
    msg = make_message(room=room, sender=user, body="hi")
    att = MessageAttachment.objects.create(
        message=msg,
        room=room,
        uploaded_by=user,
        s3_key="dm/1/2026/05/local.jpg",
        filename="local.jpg",
        mime_type="image/jpeg",
        size=2048,
    )

    data = MessageAttachmentSerializer(att).data
    assert data["url"] == "http://localhost:8080/dm/1/2026/05/local.jpg"
