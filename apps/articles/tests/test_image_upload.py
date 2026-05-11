"""Tests for article image presign + confirm API (#527 / Phase 6 P6-04).

docs/specs/article-image-upload-spec.md の T1-T8。 DM 添付 (apps/dm/tests/
test_views_attachments.py) と同じく boto3 client を patch して S3 を呼ばない
状態でロジックを検証する。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.articles.models import ArticleImage

User = get_user_model()


def _user(username: str):
    return User.objects.create_user(
        username=username,
        email=f"{username}@example.com",
        password="testpass123",  # pragma: allowlist secret
        first_name="F",
        last_name="L",
    )


def _client_for(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user=user)
    return c


def _fake_post_response(bucket: str, key: str, mime_type: str) -> dict:
    """boto3 ``generate_presigned_post`` の正常 response を模倣する."""

    return {
        "url": f"https://{bucket}.s3.ap-northeast-1.amazonaws.com/",
        "fields": {
            "key": key,
            "Content-Type": mime_type,
            "policy": "fake-policy-base64",
            "x-amz-signature": "fake-signature",
        },
    }


# ---------------------------------------------------------------------------
# Presign view (T1-T4)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_presign_view_returns_200_with_user_scoped_key(settings) -> None:
    """T1: 認証ユーザーが valid payload で叩くと 200 + s3_key が user 単位."""

    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    user = _user("alice")

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.generate_presigned_post.side_effect = (
            lambda **kw: _fake_post_response(kw["Bucket"], kw["Key"], "image/png")
        )
        resp = _client_for(user).post(
            reverse("articles:image-presign"),
            {
                "filename": "shot.png",
                "mime_type": "image/png",
                "size": 1024,
            },
            format="json",
        )

    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body["url"].startswith("https://test-bucket.s3.")
    assert body["s3_key"].startswith(f"articles/{user.pk}/")
    assert body["s3_key"].endswith(".png")
    assert "fields" in body
    assert "expires_at" in body


@pytest.mark.django_db
def test_presign_view_rejects_oversize() -> None:
    """T2: size=5MB+1 → 400 (presigned URL は発行されない)."""

    user = _user("alice")
    resp = _client_for(user).post(
        reverse("articles:image-presign"),
        {
            "filename": "huge.jpg",
            "mime_type": "image/jpeg",
            "size": 5 * 1024 * 1024 + 1,
        },
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_presign_view_rejects_unsupported_mime() -> None:
    """T3: MIME が allowlist に無い → 400."""

    user = _user("alice")
    resp = _client_for(user).post(
        reverse("articles:image-presign"),
        {
            "filename": "doc.pdf",
            "mime_type": "application/pdf",
            "size": 1024,
        },
        format="json",
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_presign_view_requires_auth() -> None:
    """T4: 匿名 → 401 (presigned URL を発行しない)."""

    resp = APIClient().post(
        reverse("articles:image-presign"),
        {
            "filename": "shot.png",
            "mime_type": "image/png",
            "size": 1024,
        },
        format="json",
    )
    assert resp.status_code in {401, 403}  # IsAuthenticated default


# ---------------------------------------------------------------------------
# Confirm view (T5-T8)
# ---------------------------------------------------------------------------


def _fake_head_object(content_length: int, content_type: str):
    """``head_object`` が返す DTO 相当の dict を作る。"""

    return {"ContentLength": content_length, "ContentType": content_type}


@pytest.mark.django_db
def test_confirm_view_creates_orphan_article_image(settings) -> None:
    """T5: head_object と申告 metadata が一致 → 201 + ArticleImage orphan 作成."""

    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    user = _user("alice")
    s3_key = f"articles/{user.pk}/abcdef12-3456-7890-abcd-ef1234567890.png"

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.return_value = _fake_head_object(
            content_length=1024,
            content_type="image/png",
        )
        resp = _client_for(user).post(
            reverse("articles:image-confirm"),
            {
                "s3_key": s3_key,
                "filename": "shot.png",
                "mime_type": "image/png",
                "size": 1024,
                "width": 800,
                "height": 600,
            },
            format="json",
        )

    assert resp.status_code == 201, resp.content
    body = resp.json()
    assert body["s3_key"] == s3_key
    assert body["width"] == 800
    assert body["height"] == 600
    assert body["size"] == 1024
    assert body["url"].endswith(s3_key)

    # DB に orphan ArticleImage が作られている (article=None, uploader=user)
    image = ArticleImage.objects.get(s3_key=s3_key)
    assert image.article_id is None
    assert image.uploader_id == user.pk
    assert image.size == 1024


@pytest.mark.django_db
def test_confirm_view_rejects_size_mismatch() -> None:
    """T6: head_object の ContentLength が申告と不一致 → 400、 row 作成されない."""

    user = _user("alice")
    s3_key = f"articles/{user.pk}/abcdef12-3456-7890-abcd-ef1234567890.png"

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.return_value = _fake_head_object(
            content_length=999,  # 申告は 1024 → 不一致
            content_type="image/png",
        )
        resp = _client_for(user).post(
            reverse("articles:image-confirm"),
            {
                "s3_key": s3_key,
                "filename": "shot.png",
                "mime_type": "image/png",
                "size": 1024,
                "width": 800,
                "height": 600,
            },
            format="json",
        )

    assert resp.status_code == 400
    assert ArticleImage.objects.filter(s3_key=s3_key).count() == 0


@pytest.mark.django_db
def test_confirm_view_rejects_foreign_user_key_prefix() -> None:
    """T7: 他ユーザーの uuid から始まる s3_key を confirm しようとしても 400 (row 作成されない)."""

    user = _user("alice")
    other = _user("bob")
    s3_key = f"articles/{other.pk}/00000000-0000-0000-0000-000000000000.png"

    # boto3 を mock しない: prefix チェックで弾かれて S3 まで行かない (期待)
    resp = _client_for(user).post(
        reverse("articles:image-confirm"),
        {
            "s3_key": s3_key,
            "filename": "shot.png",
            "mime_type": "image/png",
            "size": 1024,
            "width": 800,
            "height": 600,
        },
        format="json",
    )
    assert resp.status_code == 400
    assert ArticleImage.objects.filter(s3_key=s3_key).count() == 0


@pytest.mark.django_db
def test_confirm_view_requires_auth() -> None:
    """T8: 匿名 → 401 (head_object も呼ばれない、 row 作成されない)."""

    s3_key = "articles/00000000/00000000-0000-0000-0000-000000000000.png"
    resp = APIClient().post(
        reverse("articles:image-confirm"),
        {
            "s3_key": s3_key,
            "filename": "shot.png",
            "mime_type": "image/png",
            "size": 1024,
            "width": 800,
            "height": 600,
        },
        format="json",
    )
    assert resp.status_code in {401, 403}
    assert ArticleImage.objects.filter(s3_key=s3_key).count() == 0


# ---------------------------------------------------------------------------
# Unit-level checks for the validator (defense-in-depth for non-view callers)
# ---------------------------------------------------------------------------


def test_validate_image_request_rejects_path_traversal() -> None:
    """filename に `..` を含むと ValidationError (path traversal 対策)."""

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="../evil.png")


def test_validate_image_request_rejects_extension_mismatch() -> None:
    """filename の拡張子が mime_type と一致しなければ ValidationError."""

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="shot.jpg")


def test_validate_image_request_accepts_jpeg_with_jpg_extension() -> None:
    """``image/jpeg`` は `.jpg` と `.jpeg` の両方を受容する."""

    from apps.articles.s3_presign import validate_image_request

    # raises 無し
    validate_image_request(mime_type="image/jpeg", size=1024, filename="shot.jpg")
    validate_image_request(mime_type="image/jpeg", size=1024, filename="shot.jpeg")


def test_validate_image_request_rejects_unsupported_mime_direct() -> None:
    """validate_image_request 直叩きで unsupported MIME → ValidationError.

    view 層は ChoiceField で先に弾くが、 ``confirm_image`` など他経路から呼ばれた場合の
    fail-fast を担保する (defense-in-depth)。
    """

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="application/pdf", size=1024, filename="doc.pdf")


def test_validate_image_request_rejects_non_positive_size() -> None:
    """size <= 0 は ValidationError."""

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=0, filename="shot.png")


def test_validate_image_request_rejects_oversize_direct() -> None:
    """size > MAX_CONTENT_LENGTH は ValidationError."""

    from apps.articles.s3_presign import (
        MAX_CONTENT_LENGTH,
        validate_image_request,
    )

    with pytest.raises(DjangoValidationError):
        validate_image_request(
            mime_type="image/png", size=MAX_CONTENT_LENGTH + 1, filename="shot.png"
        )


def test_validate_image_request_rejects_empty_filename() -> None:
    """filename が空 / 過大は ValidationError."""

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="")
    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="a" * 201 + ".png")


def test_validate_image_request_rejects_filename_without_extension() -> None:
    """拡張子の無い filename は ValidationError."""

    from apps.articles.s3_presign import validate_image_request

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="no_dot_name")


def test_head_object_translates_not_found_to_validation_error() -> None:
    """S3 が NoSuchKey を返したら ValidationError("object not found")."""

    from botocore.exceptions import ClientError

    from apps.articles.s3_presign import head_object

    err = ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "HeadObject")
    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = err
        with pytest.raises(DjangoValidationError) as exc_info:
            head_object(s3_key="articles/1/abc.png")
    assert "not found" in str(exc_info.value)


def test_head_object_translates_other_errors_to_validation_error() -> None:
    """403 等 NoSuchKey 以外のエラーも ValidationError("failed to verify") に変換される."""

    from botocore.exceptions import ClientError

    from apps.articles.s3_presign import head_object

    err = ClientError({"Error": {"Code": "403", "Message": "AccessDenied"}}, "HeadObject")
    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = err
        with pytest.raises(DjangoValidationError) as exc_info:
            head_object(s3_key="articles/1/abc.png")
    assert "failed to verify" in str(exc_info.value)


def test_public_url_for_uses_custom_domain_when_set(settings) -> None:
    """``AWS_S3_CUSTOM_DOMAIN`` が設定されていれば CloudFront URL を返す."""

    from apps.articles.s3_presign import public_url_for

    settings.AWS_S3_CUSTOM_DOMAIN = "cdn.example.com"
    url = public_url_for(s3_key="articles/1/abc.png")
    assert url == "https://cdn.example.com/articles/1/abc.png"


def test_public_url_for_falls_back_to_virtual_host(settings) -> None:
    """``AWS_S3_CUSTOM_DOMAIN`` が空なら S3 virtual host URL に fallback."""

    from apps.articles.s3_presign import public_url_for

    settings.AWS_S3_CUSTOM_DOMAIN = ""
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    url = public_url_for(s3_key="articles/1/abc.png")
    assert url == ("https://test-bucket.s3.ap-northeast-1.amazonaws.com/articles/1/abc.png")
