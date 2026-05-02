"""apps.dm.s3_presign のユニットテスト (P3-06 / Issue #231).

- validate_attachment_request の正常系 / 異常系 (mime / size / filename)
- build_s3_key の形式
- generate_presigned_attachment_upload の boto3 mock
- head_object の存在検出 / 404 ハンドリング
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from django.core.exceptions import ValidationError

from apps.dm.s3_presign import (
    ALLOWED_CONTENT_TYPES,
    FILE_CONTENT_TYPES,
    IMAGE_CONTENT_TYPES,
    MAX_FILE_SIZE,
    MAX_IMAGE_SIZE,
    PRESIGN_EXPIRES_SECONDS,
    build_s3_key,
    generate_presigned_attachment_upload,
    head_object,
    validate_attachment_request,
)


@pytest.mark.parametrize(
    "mime,filename",
    [
        ("image/jpeg", "photo.jpg"),
        ("image/jpeg", "photo.jpeg"),
        ("image/png", "screen.png"),
        ("image/webp", "icon.webp"),
        ("image/gif", "anim.gif"),
        ("application/pdf", "doc.pdf"),
        ("application/zip", "bundle.zip"),
        ("text/plain", "note.txt"),
    ],
)
def test_validate_attachment_request_accepts_allowlist(mime: str, filename: str) -> None:
    ext = validate_attachment_request(mime_type=mime, size=100, filename=filename)
    assert ext in ALLOWED_CONTENT_TYPES.values()


def test_validate_attachment_request_rejects_unknown_mime() -> None:
    with pytest.raises(ValidationError, match="Unsupported mime_type"):
        validate_attachment_request(mime_type="image/heic", size=100, filename="x.heic")


def test_validate_attachment_request_rejects_size_zero() -> None:
    with pytest.raises(ValidationError, match="size must be positive"):
        validate_attachment_request(mime_type="image/jpeg", size=0, filename="x.jpg")


def test_validate_attachment_request_image_size_cap() -> None:
    with pytest.raises(ValidationError, match="exceeds maximum"):
        validate_attachment_request(
            mime_type="image/jpeg", size=MAX_IMAGE_SIZE + 1, filename="x.jpg"
        )


def test_validate_attachment_request_file_size_cap() -> None:
    with pytest.raises(ValidationError, match="exceeds maximum"):
        validate_attachment_request(
            mime_type="application/pdf", size=MAX_FILE_SIZE + 1, filename="x.pdf"
        )


def test_validate_attachment_request_image_at_image_max_ok_for_pdf_too() -> None:
    """画像 MIME の上限 (10MB) は PDF (25MB) より小さいことの確認."""
    # 10MB: 画像なら通る
    assert MAX_IMAGE_SIZE < MAX_FILE_SIZE
    validate_attachment_request(mime_type="image/jpeg", size=MAX_IMAGE_SIZE, filename="x.jpg")


def test_validate_attachment_request_rejects_path_traversal() -> None:
    with pytest.raises(ValidationError, match="invalid characters"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="../etc/passwd.jpg")


def test_validate_attachment_request_rejects_slash_in_filename() -> None:
    with pytest.raises(ValidationError, match="invalid characters"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="dir/photo.jpg")


def test_validate_attachment_request_rejects_backslash_in_filename() -> None:
    with pytest.raises(ValidationError, match="invalid characters"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="dir\\photo.jpg")


def test_validate_attachment_request_rejects_control_char() -> None:
    with pytest.raises(ValidationError, match="invalid characters"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="bad\x00name.jpg")


def test_validate_attachment_request_rejects_extension_mismatch() -> None:
    with pytest.raises(ValidationError, match="does not match mime_type"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="photo.png")


def test_validate_attachment_request_rejects_no_extension() -> None:
    with pytest.raises(ValidationError, match="must have an extension"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="photo")


def test_validate_attachment_request_rejects_empty_filename() -> None:
    with pytest.raises(ValidationError):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename="")


def test_validate_attachment_request_rejects_too_long_filename() -> None:
    long_name = "a" * 300 + ".jpg"
    with pytest.raises(ValidationError, match="1..200 chars"):
        validate_attachment_request(mime_type="image/jpeg", size=100, filename=long_name)


# ---------------------------------------------------------------------------
# build_s3_key
# ---------------------------------------------------------------------------


def test_build_s3_key_format() -> None:
    key = build_s3_key(room_id=42, ext="png")
    assert key.startswith("dm/42/")
    assert key.endswith(".png")
    parts = key.split("/")
    # dm / <room> / <yyyy> / <mm> / <uuid>.png
    assert len(parts) == 5
    assert parts[0] == "dm"
    assert parts[1] == "42"
    assert len(parts[2]) == 4  # yyyy
    assert len(parts[3]) == 2  # mm


# ---------------------------------------------------------------------------
# generate_presigned_attachment_upload (boto3 mock)
# ---------------------------------------------------------------------------


def _fake_s3_post_response(bucket: str, key: str) -> dict:
    return {
        "url": f"https://{bucket}.s3.ap-northeast-1.amazonaws.com/",
        "fields": {
            "key": key,
            "Content-Type": "image/jpeg",
            "policy": "BASE64POLICY",
            "x-amz-signature": "SIG",
        },
    }


def test_generate_presigned_attachment_upload_returns_dto(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"

    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        client = build_client.return_value
        client.generate_presigned_post.side_effect = lambda **kw: _fake_s3_post_response(
            kw["Bucket"], kw["Key"]
        )

        result = generate_presigned_attachment_upload(
            room_id=7, mime_type="image/jpeg", size=1024, filename="photo.jpg"
        )

    assert result.url.startswith("https://test-bucket.s3.")
    assert result.fields["key"] == result.s3_key
    assert result.s3_key.startswith("dm/7/")
    assert result.s3_key.endswith(".jpg")
    # generate_presigned_post の Conditions に渡したサイズ上限が image なら 10MB であること
    assert client.generate_presigned_post.call_args.kwargs["Conditions"][0][2] == MAX_IMAGE_SIZE


def test_generate_presigned_attachment_upload_rejects_invalid_mime() -> None:
    with pytest.raises(ValidationError):
        generate_presigned_attachment_upload(
            room_id=1, mime_type="image/heic", size=10, filename="x.heic"
        )


def test_generate_presigned_attachment_upload_uses_pdf_max_size_for_pdf(
    settings,
) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"

    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        client = build_client.return_value
        client.generate_presigned_post.side_effect = lambda **kw: _fake_s3_post_response(
            kw["Bucket"], kw["Key"]
        )
        generate_presigned_attachment_upload(
            room_id=7, mime_type="application/pdf", size=2 * 1024, filename="doc.pdf"
        )

    cond = client.generate_presigned_post.call_args.kwargs["Conditions"][0]
    assert cond[0] == "content-length-range"
    assert cond[2] == MAX_FILE_SIZE


# ---------------------------------------------------------------------------
# head_object
# ---------------------------------------------------------------------------


def _make_client_error(code: str) -> ClientError:
    return ClientError(
        error_response={"Error": {"Code": code, "Message": "x"}},
        operation_name="HeadObject",
    )


def test_head_object_returns_metadata(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.return_value = {
            "ContentLength": 1234,
            "ContentType": "image/jpeg",
        }
        info = head_object(s3_key="dm/1/2026/05/abc.jpg")
    assert info.content_length == 1234
    assert info.content_type == "image/jpeg"


def test_head_object_404_raises_validation(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = _make_client_error("NoSuchKey")
        with pytest.raises(ValidationError, match="object not found"):
            head_object(s3_key="dm/1/2026/05/missing.jpg")


def test_head_object_other_error_raises_validation(settings) -> None:
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    with patch("apps.dm.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = _make_client_error("403")
        with pytest.raises(ValidationError, match="failed to verify object"):
            head_object(s3_key="dm/1/2026/05/forbidden.jpg")


def test_image_and_file_content_types_disjoint() -> None:
    assert set(IMAGE_CONTENT_TYPES) & set(FILE_CONTENT_TYPES) == set()


def test_presign_expires_seconds_reasonable() -> None:
    # 5 分。あまりに長いと CSRF 漏洩リスク、短いと UX 悪化。
    assert 60 <= PRESIGN_EXPIRES_SECONDS <= 600
