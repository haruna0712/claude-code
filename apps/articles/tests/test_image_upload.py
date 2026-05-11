"""Tests for article image presign + confirm API (#527 / Phase 6 P6-04).

docs/specs/article-image-upload-spec.md の T1-T8。 DM 添付 (apps/dm/tests/
test_views_attachments.py) と同じく boto3 client を patch して S3 を呼ばない
状態でロジックを検証する。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from botocore.exceptions import ClientError
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.urls import reverse
from rest_framework.test import APIClient

from apps.articles.models import ArticleImage
from apps.articles.s3_presign import (
    MAX_CONTENT_LENGTH,
    head_object,
    public_url_for,
    validate_image_request,
)
from apps.articles.services.images import confirm_image

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
def test_confirm_view_rejects_content_type_mismatch(settings) -> None:
    """T5b (spec §5 T6 同等の Content-Type 版): head_object の ContentType が申告と
    不一致 → 400、 row 作成されない (MIME 偽装防止)."""

    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    user = _user("alice")
    s3_key = f"articles/{user.pk}/abcdef12-3456-7890-abcd-ef1234567890.png"

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.return_value = _fake_head_object(
            content_length=1024,
            content_type="image/jpeg",  # 申告は image/png → 不一致
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
def test_confirm_view_rejects_path_traversal_in_key() -> None:
    """T7b: s3_key に ``..`` を含むと posixpath.normpath で正規化後と元が一致せず 400.

    `articles/<user>/../<user>/foo.png` のような形は、 正規化後は self-prefix に
    一致してしまうが、 元の文字列に traversal 表記があるので DB 行を作らない。
    """

    user = _user("alice")
    s3_key = f"articles/{user.pk}/sub/../malicious.png"
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
    """filename に `../` を含むと ValidationError (path traversal 対策)."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="../evil.png")


def test_validate_image_request_rejects_extension_mismatch() -> None:
    """filename の拡張子が mime_type と一致しなければ ValidationError."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="shot.jpg")


def test_validate_image_request_accepts_jpeg_with_jpg_extension() -> None:
    """``image/jpeg`` は `.jpg` と `.jpeg` の両方を受容する."""

    # raises 無し
    validate_image_request(mime_type="image/jpeg", size=1024, filename="shot.jpg")
    validate_image_request(mime_type="image/jpeg", size=1024, filename="shot.jpeg")


def test_validate_image_request_accepts_double_dot_in_middle() -> None:
    """``photo..backup.png`` のような中間連続ドットは accept する.

    docs/specs/article-image-upload-spec.md §3.1 で意図的に許容している (path separator が
    無ければ traversal にならない)。 DM の filename pattern とは挙動が異なる。
    """

    # raises 無し
    validate_image_request(mime_type="image/png", size=1024, filename="photo..backup.png")


def test_validate_image_request_rejects_unsupported_mime_direct() -> None:
    """validate_image_request 直叩きで unsupported MIME → ValidationError.

    view 層は ChoiceField で先に弾くが、 ``confirm_image`` など他経路から呼ばれた場合の
    fail-fast を担保する (defense-in-depth)。
    """

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="application/pdf", size=1024, filename="doc.pdf")


def test_validate_image_request_rejects_non_positive_size() -> None:
    """size <= 0 は ValidationError."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=0, filename="shot.png")


def test_validate_image_request_rejects_oversize_direct() -> None:
    """size > MAX_CONTENT_LENGTH は ValidationError."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(
            mime_type="image/png", size=MAX_CONTENT_LENGTH + 1, filename="shot.png"
        )


def test_validate_image_request_rejects_empty_filename() -> None:
    """filename が空 / 過大は ValidationError."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="")
    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="a" * 201 + ".png")


def test_validate_image_request_rejects_filename_without_extension() -> None:
    """拡張子の無い filename は ValidationError."""

    with pytest.raises(DjangoValidationError):
        validate_image_request(mime_type="image/png", size=1024, filename="no_dot_name")


def test_head_object_translates_not_found_to_validation_error() -> None:
    """S3 が NoSuchKey を返したら ValidationError("object not found")."""

    err = ClientError({"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "HeadObject")
    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = err
        with pytest.raises(DjangoValidationError) as exc_info:
            head_object(s3_key="articles/1/abc.png")
    assert "not found" in str(exc_info.value)


def test_head_object_translates_other_errors_to_validation_error() -> None:
    """403 等 NoSuchKey 以外のエラーも ValidationError("failed to verify") に変換される."""

    err = ClientError({"Error": {"Code": "403", "Message": "AccessDenied"}}, "HeadObject")
    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.side_effect = err
        with pytest.raises(DjangoValidationError) as exc_info:
            head_object(s3_key="articles/1/abc.png")
    assert "failed to verify" in str(exc_info.value)


def test_public_url_for_uses_custom_domain_when_set(settings) -> None:
    """``AWS_S3_CUSTOM_DOMAIN`` が設定されていれば CloudFront URL を返す."""

    settings.AWS_S3_CUSTOM_DOMAIN = "cdn.example.com"
    url = public_url_for(s3_key="articles/1/abc.png")
    assert url == "https://cdn.example.com/articles/1/abc.png"


def test_public_url_for_falls_back_to_virtual_host(settings) -> None:
    """``AWS_S3_CUSTOM_DOMAIN`` が空なら S3 virtual host URL に fallback."""

    settings.AWS_S3_CUSTOM_DOMAIN = ""
    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    url = public_url_for(s3_key="articles/1/abc.png")
    assert url == ("https://test-bucket.s3.ap-northeast-1.amazonaws.com/articles/1/abc.png")


# ---------------------------------------------------------------------------
# Security: s3_key control chars (security-reviewer M-1)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_key",
    [
        "articles/1/abc.png\nINJECT",
        "articles/1/abc.png\x00null",
        "articles/1/abc\x7fdel.png",
        "articles/1/abc\rcr.png",
        "articles/1/abc\ttab.png",
        "articles/1/中文.png",  # non-ASCII not in allowlist
        "articles/1/space inside.png",
    ],
)
@pytest.mark.django_db
def test_confirm_view_rejects_s3_key_with_control_chars(bad_key: str) -> None:
    """M-1: s3_key の RegexField allowlist で制御文字 / 非 ASCII / space は 400 になる.

    serializer 層で弾くため head_object に到達せず、 boto3 内部にも非正規文字を渡さない
    (defense-in-depth)。 ``posixpath.normpath`` は path-separator 系しか正規化しないため
    制御文字を含む key が ``normalised == s3_key`` を通過してしまう穴を塞ぐ。
    """

    user = _user("alice")
    resp = _client_for(user).post(
        reverse("articles:image-confirm"),
        {
            "s3_key": bad_key,
            "filename": "shot.png",
            "mime_type": "image/png",
            "size": 1024,
            "width": 800,
            "height": 600,
        },
        format="json",
    )
    # serializer 段階で 400、 head_object / DB に到達しない。 NUL を含む key は
    # PostgreSQL の COUNT も呼べないので、 ここでは status だけ確認する (件数 0 は
    # 「未到達」 とほぼ等価)。
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Security: Bearer token must not authenticate (security-reviewer M-3)
# ---------------------------------------------------------------------------


def test_image_views_use_explicit_cookie_authentication() -> None:
    """M-3: ``authentication_classes = [CookieAuthentication]`` が明示されていることを
    確認する.

    本プロジェクトの ``CookieAuthentication`` は ``JWTAuthentication`` を継承していて
    Bearer header も accept する (cookie_auth.py:75-79 参照、 意図的)。 重要なのは
    DRF default の auth 順序 (JWTAuthentication → CookieAuthentication) を素通しに
    せず、 CSRF enforce が必要な cookie 経路を統一クラスに寄せている点。 tweet view と
    同じ class 構成にする (reviewer M-3 反映)。
    """

    from apps.articles.views import ConfirmArticleImageView, PresignArticleImageView
    from apps.common.cookie_auth import CookieAuthentication

    assert PresignArticleImageView.authentication_classes == [CookieAuthentication]
    assert ConfirmArticleImageView.authentication_classes == [CookieAuthentication]


# ---------------------------------------------------------------------------
# Dimension boundary tests (review MEDIUM-2)
# ---------------------------------------------------------------------------


def _confirm_kwargs(user, **overrides):
    """``confirm_image`` の典型 kwargs を組む helper (boundary テスト用)."""

    base = {
        "user": user,
        "s3_key": f"articles/{user.pk}/abc.png",
        "filename": "shot.png",
        "mime_type": "image/png",
        "size": 1024,
        "width": 800,
        "height": 600,
    }
    base.update(overrides)
    return base


@pytest.mark.django_db
def test_confirm_image_rejects_width_zero() -> None:
    """width=0 は service レベルで ValidationError (serializer bypass 経路の保険)."""

    user = _user("alice")
    with pytest.raises(DjangoValidationError):
        confirm_image(**_confirm_kwargs(user, width=0))


@pytest.mark.django_db
def test_confirm_image_rejects_height_over_max() -> None:
    """height=10001 (10000 + 1) は service レベルで ValidationError."""

    user = _user("alice")
    with pytest.raises(DjangoValidationError):
        confirm_image(**_confirm_kwargs(user, height=10001))


@pytest.mark.django_db
def test_confirm_image_rejects_bool_as_dimension() -> None:
    """Python の ``True`` / ``False`` は ``int`` のサブクラスだが service は弾く.

    serializer の ``IntegerField`` も bool を許さないが、 service が独立呼びされる
    場合の保険として明示的にチェックしている。
    """

    user = _user("alice")
    with pytest.raises(DjangoValidationError):
        confirm_image(**_confirm_kwargs(user, width=True))


# ---------------------------------------------------------------------------
# IntegrityError → 400 (database-reviewer HIGH H-1)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_confirm_view_returns_400_on_duplicate_s3_key(settings) -> None:
    """H-1: 同一 s3_key で confirm が二重呼び出しされたら 500 ではなく 400 に変換.

    network retry / 二重 submit が起きたケースを想定。 unique constraint で
    IntegrityError が走るが、 view 層で DRFValidationError に変換する。
    """

    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    user = _user("alice")
    s3_key = f"articles/{user.pk}/abcdef12-3456-7890-abcd-ef1234567890.png"

    payload = {
        "s3_key": s3_key,
        "filename": "shot.png",
        "mime_type": "image/png",
        "size": 1024,
        "width": 800,
        "height": 600,
    }

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.head_object.return_value = _fake_head_object(
            content_length=1024,
            content_type="image/png",
        )
        # 1 回目: 201 で確定する
        resp1 = _client_for(user).post(reverse("articles:image-confirm"), payload, format="json")
        assert resp1.status_code == 201

        # 2 回目: 既に確定済の s3_key なので 400 (500 にはならない)
        resp2 = _client_for(user).post(reverse("articles:image-confirm"), payload, format="json")

    assert resp2.status_code == 400
    # 重複しても DB には 1 行だけ残る
    assert ArticleImage.objects.filter(s3_key=s3_key).count() == 1


# ---------------------------------------------------------------------------
# Conditions assertion (review MEDIUM-3)
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_presign_view_passes_correct_conditions_to_s3(settings) -> None:
    """presign 発行時に S3 へ渡る ``Conditions`` が spec 通りであることを確認.

    Conditions は S3 側で content-length-range / eq Content-Type / eq key を強制する
    primary な security mechanism。 regression で削除 / 弱体化されないようテストで保護する。
    """

    settings.AWS_STORAGE_BUCKET_NAME = "test-bucket"
    settings.AWS_S3_REGION_NAME = "ap-northeast-1"
    user = _user("alice")

    with patch("apps.articles.s3_presign._build_s3_client") as build_client:
        build_client.return_value.generate_presigned_post.side_effect = (
            lambda **kw: _fake_post_response(kw["Bucket"], kw["Key"], "image/png")
        )
        _client_for(user).post(
            reverse("articles:image-presign"),
            {"filename": "shot.png", "mime_type": "image/png", "size": 1024},
            format="json",
        )

        # generate_presigned_post の呼び出し引数を確認
        assert build_client.return_value.generate_presigned_post.call_count == 1
        kwargs = build_client.return_value.generate_presigned_post.call_args.kwargs
        conditions = kwargs["Conditions"]

    # content-length-range を含む
    assert ["content-length-range", 1, MAX_CONTENT_LENGTH] in conditions
    # eq Content-Type を含む (申告 MIME と完全一致)
    assert {"Content-Type": "image/png"} in conditions
    # eq key を含む (s3_key の流用攻撃を防ぐ)
    assert any(
        isinstance(c, dict) and "key" in c and c["key"].startswith(f"articles/{user.pk}/")
        for c in conditions
    )
