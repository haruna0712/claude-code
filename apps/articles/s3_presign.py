"""記事内画像の S3 直アップロード用 presigned URL ユーティリティ (#527 / Phase 6 P6-04).

設計方針 (docs/specs/article-image-upload-spec.md §1):

- フロントエンド → S3 へ直接 PUT し、 Django は presigned URL 発行 + ``head_object``
  再検証のみを担う。 サーバ帯域 / CPU を画像で食わない。
- ``apps.dm.s3_presign`` (DM 添付) と同じ ``generate_presigned_post`` 方式を採用し、
  ``content-length-range`` / ``eq Content-Type`` / ``eq key`` を S3 側で強制する
  (security HIGH H-1/H-2/H-3 反映済の流儀をそのまま継承)。
- 許可 MIME: ``image/jpeg`` / ``image/png`` / ``image/webp`` / ``image/gif`` の 4 種。
  サイズ上限 5 MiB (``ArticleImage.size`` モデルの想定上限と整合)。
- ``s3_key`` 形式: ``articles/<user_id>/<image_uuid>.<ext>``。
  user_id を path に含めることで confirm 側で他人の key を弾ける (IDOR 防止)。
- boto3 client は関数内で生成 — テストで ``patch("apps.articles.s3_presign._build_s3_client", ...)``
  しやすく、 ECS task role の credential rotation にも耐える。
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final
from urllib.parse import quote

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import ClientError
from django.conf import settings
from django.core.exceptions import ValidationError

logger = logging.getLogger(__name__)

# -----------------------------------------------------------------------------
# 定数 (spec §3.1)
# -----------------------------------------------------------------------------

#: 許可する MIME と対応する拡張子。 allowlist 方式で明示。
ALLOWED_CONTENT_TYPES: Final[dict[str, str]] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

#: アップロード許可サイズ上限 (5 MiB)。 ``ArticleImage.size`` モデルのドキュメント想定値。
MAX_CONTENT_LENGTH: Final[int] = 5 * 1024 * 1024

#: presigned POST の有効期間 (秒)。 フロント取得 → S3 PUT 完了まで 5 分は十分。
PRESIGN_EXPIRES_SECONDS: Final[int] = 5 * 60

#: filename の文字長上限。 安全側で 200 文字 (DM 添付と整合)。
FILENAME_MAX_LENGTH: Final[int] = 200

#: filename の不許可 character pattern。 制御文字 / NUL / path separator を排除。
#  Unicode (日本語ファイル名) と中間の連続ドット (例: ``photo..backup.png``) は許可する。
#  パストラバーサルは ``/`` ``\`` をブロックすれば防げる (single component の filename 文脈)。
#  filename が完全一致で ``..`` のみのケースは別途 :func:`validate_image_request` で弾く
#  (拡張子チェックで rfind 後の actual_ext が空文字になり ValidationError)。
_FILENAME_INVALID_PATTERN: Final[re.Pattern[str]] = re.compile(r"[\x00-\x1f\x7f/\\]")


# -----------------------------------------------------------------------------
# DTO
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class PresignedImageUpload:
    """presigned POST 発行結果 (immutable DTO).

    ``url``: フロントが POST するエンドポイント (S3 bucket URL)
    ``fields``: presigned POST の hidden field (key / Content-Type / policy / signature ...)
    ``s3_key``: 紐付け用に Confirm API へ送る S3 オブジェクトキー
    ``expires_at``: presign の有効期限 (フロント表示用)
    """

    url: str
    fields: dict[str, str]
    s3_key: str
    expires_at: datetime


@dataclass(frozen=True)
class S3ObjectInfo:
    """``head_object`` で取得した実 metadata (immutable)."""

    content_length: int
    content_type: str


# -----------------------------------------------------------------------------
# 検証
# -----------------------------------------------------------------------------


def validate_image_request(
    *,
    mime_type: str,
    size: int,
    filename: str,
) -> str:
    """presign 発行前 / confirm 受け取り時の入力検証.

    Args:
        mime_type: クライアント申告の MIME。 allowlist と一致する必要がある。
        size: バイト数。 1 以上 5 MiB 以下。
        filename: ファイル名。 path traversal / 制御文字 / 拡張子検証.

    Returns:
        正規化された拡張子 (例 ``"png"``).

    Raises:
        ValidationError: いずれかの検証に失敗した場合。
    """

    if mime_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            f"Unsupported mime_type: {mime_type!r}. Allowed: {sorted(ALLOWED_CONTENT_TYPES)}"
        )

    if size <= 0:
        raise ValidationError("size must be positive")
    if size > MAX_CONTENT_LENGTH:
        raise ValidationError(f"size {size} exceeds maximum {MAX_CONTENT_LENGTH} bytes")

    if not filename or len(filename) > FILENAME_MAX_LENGTH:
        raise ValidationError(
            f"filename must be 1..{FILENAME_MAX_LENGTH} chars (got {len(filename)})"
        )
    if _FILENAME_INVALID_PATTERN.search(filename):
        raise ValidationError("filename contains invalid characters (path traversal / control)")

    expected_ext = ALLOWED_CONTENT_TYPES[mime_type]
    name_lower = filename.lower()
    dot_idx = name_lower.rfind(".")
    if dot_idx < 0:
        raise ValidationError("filename must have an extension matching the mime_type")
    actual_ext = name_lower[dot_idx + 1 :]
    accepted_exts = {expected_ext}
    if expected_ext == "jpg":
        accepted_exts.add("jpeg")
    if actual_ext not in accepted_exts:
        raise ValidationError(
            f"filename extension '.{actual_ext}' does not match mime_type {mime_type}"
        )

    return expected_ext


# -----------------------------------------------------------------------------
# 公開 API
# -----------------------------------------------------------------------------


def build_s3_key(*, user_id: int, ext: str) -> str:
    """``articles/<user_id>/<image_uuid>.<ext>`` を生成.

    user_id は ``User.pk`` (BigAutoField → int) 前提。
    """

    return f"articles/{user_id}/{uuid.uuid4()}.{ext}"


def generate_presigned_image_upload(
    *,
    user_id: int,
    mime_type: str,
    size: int,
    filename: str,
) -> PresignedImageUpload:
    """記事内画像の presigned POST URL を発行する.

    Args:
        user_id: アップロードするユーザーの PK。 s3_key prefix に埋め込む (IDOR 防止)。
        mime_type: 申告 MIME (allowlist に一致)。
        size: 申告 bytes。
        filename: ファイル名 (拡張子検証用)。

    Returns:
        ``PresignedImageUpload`` (url / fields / s3_key / expires_at)

    Raises:
        ValidationError: 入力検証失敗。
    """

    ext = validate_image_request(mime_type=mime_type, size=size, filename=filename)
    s3_key = build_s3_key(user_id=user_id, ext=ext)
    bucket = settings.AWS_STORAGE_BUCKET_NAME

    s3_client = _build_s3_client()

    # S3 側で Conditions を強制チェックさせる。
    #   - content-length-range: 1..MAX_CONTENT_LENGTH (改ざんによる DoS / 巨大 PUT 防止)
    #   - eq Content-Type: アプリ側申告と完全一致 (MIME 偽装防止)
    #   - eq key: 別ファイルへの上書き / 別 key への流用攻撃防止
    try:
        post_data = s3_client.generate_presigned_post(
            Bucket=bucket,
            Key=s3_key,
            Fields={"Content-Type": mime_type, "key": s3_key},
            Conditions=[
                ["content-length-range", 1, MAX_CONTENT_LENGTH],
                {"Content-Type": mime_type},
                {"key": s3_key},
            ],
            ExpiresIn=PRESIGN_EXPIRES_SECONDS,
        )
    except ClientError as exc:  # pragma: no cover - boto3 internal failure
        logger.error(
            "articles.image_presign.failed",
            exc_info=exc,
            extra={"event": "articles.image_presign.failed"},
        )
        raise ValidationError("failed to issue presigned URL") from exc

    expires_at = datetime.now(tz=UTC) + timedelta(seconds=PRESIGN_EXPIRES_SECONDS)
    return PresignedImageUpload(
        url=post_data["url"],
        fields=post_data["fields"],
        s3_key=s3_key,
        expires_at=expires_at,
    )


def head_object(*, s3_key: str) -> S3ObjectInfo:
    """S3 上の object metadata を取得する (Confirm API での再検証用).

    Args:
        s3_key: 検査対象のオブジェクトキー。

    Returns:
        :class:`S3ObjectInfo`

    Raises:
        ValidationError: object が存在しない / アクセス不能。
    """

    s3_client = _build_s3_client()
    try:
        resp = s3_client.head_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=s3_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise ValidationError(f"object not found: {s3_key}") from exc
        logger.warning(
            "articles.head_object.unexpected",
            exc_info=exc,
            extra={
                "event": "articles.head_object.unexpected",
                "code": code,
                "key": s3_key,
            },
        )
        raise ValidationError(f"failed to verify object: {s3_key}") from exc

    content_length = int(resp.get("ContentLength", 0))
    content_type = str(resp.get("ContentType", ""))
    return S3ObjectInfo(content_length=content_length, content_type=content_type)


def public_url_for(*, s3_key: str) -> str:
    """画像配信用の公開 URL を組み立てる (CloudFront 経由 or 直 S3).

    ``AWS_S3_CUSTOM_DOMAIN`` (CloudFront) があればそれ経由、 なければ S3 virtual host。
    """

    custom_domain = getattr(settings, "AWS_S3_CUSTOM_DOMAIN", "") or ""
    if custom_domain:
        return f"https://{custom_domain}/{quote(s3_key)}"
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    region = settings.AWS_S3_REGION_NAME
    return f"https://{bucket}.s3.{region}.amazonaws.com/{quote(s3_key)}"


# -----------------------------------------------------------------------------
# Internal: boto3 client
# -----------------------------------------------------------------------------


def _build_s3_client() -> Any:
    """boto3 S3 client を生成する (apps.dm.s3_presign と同方針).

    関数内生成にすることで:
    - ``patch("apps.articles.s3_presign._build_s3_client", ...)`` でテスト mock 可能
    - 環境 credential rotation 時にも次回呼び出しから新 credential を拾える
    """

    return boto3.client(
        "s3",
        region_name=settings.AWS_S3_REGION_NAME,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
        config=BotoConfig(
            signature_version=getattr(settings, "AWS_S3_SIGNATURE_VERSION", "s3v4"),
            s3={"addressing_style": getattr(settings, "AWS_S3_ADDRESSING_STYLE", "virtual")},
        ),
    )
