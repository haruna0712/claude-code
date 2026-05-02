"""DM 添付ファイルの S3 直アップロード用 presigned URL ユーティリティ (P3-06 / Issue #231).

設計方針:

- 大容量バイナリで Channels イベントループを止めないため、フロント → S3 直 PUT。
  Django は presigned URL を発行 + S3 保存後の確定 (head_object 再検証) のみ実施。
- 許可 MIME / 拡張子 / サイズ上限は SPEC §7.3 に従う:
  * 画像: jpg/png/webp/gif → 最大 10MB、最大 5 枚 / 送信
  * ファイル: pdf/zip/text/plain → 最大 25MB、最大 1 枚 / 送信
- ``s3_key`` 形式: ``dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>`` (services._validate_attachment_keys
  と整合)。room_id を path に含めることで IDOR 防止を二重化する (IAM policy + key 検証)。
- presigned POST (boto3 ``generate_presigned_post``) を使う。
  * ``Conditions`` で ``content-length-range`` / ``starts-with $Content-Type`` /
    ``eq $key`` をハードコード強制。SPEC 違反のサイズ・MIME を S3 側でも弾く。
- boto3 client は関数内で生成 (``apps.users.s3_presign`` と同じ方針) — テスト mock しやすく、
  かつ ECS task role の credential rotation に耐える。

エラー方針:
- フロント入力 (mime / size / filename) の検証は ``ValidationError`` で 400 を返す。
- ``head_object`` で実物が S3 に存在しない場合は ``ValidationError`` (400)、
  ファイルサイズや Content-Type が申告と異なる場合も同じく 400 (改ざん防止)。
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
# 定数 (SPEC §7.3)
# -----------------------------------------------------------------------------

#: 画像系 MIME と拡張子。``filename`` extension はこの値と一致する必要がある。
IMAGE_CONTENT_TYPES: Final[dict[str, str]] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

#: ファイル系 MIME と拡張子。
FILE_CONTENT_TYPES: Final[dict[str, str]] = {
    "application/pdf": "pdf",
    "application/zip": "zip",
    "text/plain": "txt",
}

ALLOWED_CONTENT_TYPES: Final[dict[str, str]] = {**IMAGE_CONTENT_TYPES, **FILE_CONTENT_TYPES}

#: ``image/jpeg`` 等の画像 MIME 用上限 (10 MiB)。
MAX_IMAGE_SIZE: Final[int] = 10 * 1024 * 1024

#: ``application/pdf`` 等のファイル MIME 用上限 (25 MiB)。
MAX_FILE_SIZE: Final[int] = 25 * 1024 * 1024

#: presigned URL の有効期間 (秒)。フロントが取得 → S3 PUT 完了までで 5 分は十分余裕。
PRESIGN_EXPIRES_SECONDS: Final[int] = 5 * 60

#: filename の文字長上限。MessageAttachment.filename と整合 (max_length=200)。
FILENAME_MAX_LENGTH: Final[int] = 200

#: filename の許可 character pattern。path traversal / NUL / 制御文字を排除。
#  Unicode 文字 (日本語ファイル名) は許可するが ``/`` ``\`` ``..`` はブロック。
_FILENAME_INVALID_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"[\x00-\x1f\x7f/\\]|\.\."  # 制御文字 / sep / parent traversal
)


# -----------------------------------------------------------------------------
# DTO
# -----------------------------------------------------------------------------


@dataclass(frozen=True)
class PresignedAttachmentUpload:
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


# -----------------------------------------------------------------------------
# 検証
# -----------------------------------------------------------------------------


def _max_size_for(mime_type: str) -> int:
    """MIME タイプに応じたサイズ上限を返す。"""

    if mime_type in IMAGE_CONTENT_TYPES:
        return MAX_IMAGE_SIZE
    if mime_type in FILE_CONTENT_TYPES:
        return MAX_FILE_SIZE
    raise ValidationError(
        f"Unsupported mime_type: {mime_type!r}. Allowed: {sorted(ALLOWED_CONTENT_TYPES)}"
    )


def validate_attachment_request(
    *,
    mime_type: str,
    size: int,
    filename: str,
) -> str:
    """presign 発行前の入力検証.

    Args:
        mime_type: クライアント申告の MIME。allowlist と一致する必要がある。
        size: バイト数。MIME に応じた上限以下。
        filename: ファイル名。path traversal / 制御文字 / 拡張子検証.

    Returns:
        正規化された拡張子 (``"png"`` 等)。

    Raises:
        ValidationError: いずれかの検証に失敗した場合。
    """

    if mime_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            f"Unsupported mime_type: {mime_type!r}. Allowed: {sorted(ALLOWED_CONTENT_TYPES)}"
        )

    max_size = _max_size_for(mime_type)
    if size <= 0:
        raise ValidationError("size must be positive")
    if size > max_size:
        raise ValidationError(f"size {size} exceeds maximum {max_size} bytes for {mime_type}")

    if not filename or len(filename) > FILENAME_MAX_LENGTH:
        raise ValidationError(
            f"filename must be 1..{FILENAME_MAX_LENGTH} chars (got {len(filename)})"
        )
    if _FILENAME_INVALID_PATTERN.search(filename):
        raise ValidationError("filename contains invalid characters (path traversal / control)")

    expected_ext = ALLOWED_CONTENT_TYPES[mime_type]
    # filename の拡張子 (最後の dot 以降) と mime_type の対応を一致確認。
    # ``photo.tar.gz`` のように multi-dot でも最後の dot のみ採用。
    name_lower = filename.lower()
    dot_idx = name_lower.rfind(".")
    if dot_idx < 0:
        raise ValidationError("filename must have an extension matching the mime_type")
    actual_ext = name_lower[dot_idx + 1 :]
    # ``image/jpeg`` の場合、``jpg`` と ``jpeg`` 両方を受容する。
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


def build_s3_key(*, room_id: int, ext: str) -> str:
    """``dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>`` を生成.

    services._validate_attachment_keys_for_room と同形式。
    """

    now = datetime.now(tz=UTC)
    return f"dm/{int(room_id)}/{now.year:04d}/{now.month:02d}/{uuid.uuid4()}.{ext}"


def generate_presigned_attachment_upload(
    *,
    room_id: int,
    mime_type: str,
    size: int,
    filename: str,
) -> PresignedAttachmentUpload:
    """DM 添付の presigned POST URL を発行する.

    Args:
        room_id: アップロード先 DMRoom の PK。s3_key prefix に埋め込む (IDOR 防止)。
        mime_type: 申告 MIME (allowlist に一致)。
        size: 申告 bytes。
        filename: ファイル名 (拡張子検証用)。

    Returns:
        ``PresignedAttachmentUpload`` (url / fields / s3_key / expires_at)

    Raises:
        ValidationError: 入力検証失敗。
    """

    ext = validate_attachment_request(mime_type=mime_type, size=size, filename=filename)
    s3_key = build_s3_key(room_id=room_id, ext=ext)
    max_size = _max_size_for(mime_type)
    bucket = settings.AWS_STORAGE_BUCKET_NAME

    s3_client = _build_s3_client()

    # presigned POST: S3 側で Conditions を強制チェックする。
    #   - content-length-range: 1..max_size (改ざん時の DoS / 巨大 PUT 防止)
    #   - starts-with $Content-Type mime_type: アプリ側申告と一致
    #   - eq $key s3_key: 別ファイルへの上書き防止 (presigned URL 流用攻撃)
    try:
        post_data = s3_client.generate_presigned_post(
            Bucket=bucket,
            Key=s3_key,
            Fields={"Content-Type": mime_type, "key": s3_key},
            Conditions=[
                ["content-length-range", 1, max_size],
                ["starts-with", "$Content-Type", mime_type],
                {"key": s3_key},
            ],
            ExpiresIn=PRESIGN_EXPIRES_SECONDS,
        )
    except ClientError as exc:  # pragma: no cover - boto3 の internal failure
        logger.error("dm.presign.failed", exc_info=exc, extra={"event": "dm.presign.failed"})
        raise ValidationError("failed to issue presigned URL") from exc

    expires_at = datetime.now(tz=UTC) + timedelta(seconds=PRESIGN_EXPIRES_SECONDS)
    return PresignedAttachmentUpload(
        url=post_data["url"],
        fields=post_data["fields"],
        s3_key=s3_key,
        expires_at=expires_at,
    )


@dataclass(frozen=True)
class S3ObjectInfo:
    """``head_object`` で取得した実 metadata (immutable)."""

    content_length: int
    content_type: str


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
        # 404 / NoSuchKey: フロント側 PUT 失敗、または別 key への流用攻撃。
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise ValidationError(f"object not found: {s3_key}") from exc
        # それ以外 (403 等) は presign 設定不備や IAM 不整合。logger に残す。
        logger.warning(
            "dm.head_object.unexpected",
            extra={"event": "dm.head_object.unexpected", "code": code, "key": s3_key},
        )
        raise ValidationError(f"failed to verify object: {s3_key}") from exc

    content_length = int(resp.get("ContentLength", 0))
    content_type = str(resp.get("ContentType", ""))
    return S3ObjectInfo(content_length=content_length, content_type=content_type)


def delete_object(*, s3_key: str) -> None:
    """S3 object を 1 件削除する (orphan GC / メッセージ削除時に使用).

    削除失敗は warning ログに残して swallow する (best-effort)。S3 側に残骸が残っても
    再試行可能 (lifecycle rule で 365 日後に自動削除されるため致命的ではない)。
    """

    s3_client = _build_s3_client()
    try:
        s3_client.delete_object(Bucket=settings.AWS_STORAGE_BUCKET_NAME, Key=s3_key)
    except ClientError as exc:  # pragma: no cover - rare
        logger.warning(
            "dm.delete_object.failed",
            extra={"event": "dm.delete_object.failed", "key": s3_key},
            exc_info=exc,
        )


# -----------------------------------------------------------------------------
# Internal: boto3 client
# -----------------------------------------------------------------------------


def _build_s3_client() -> Any:
    """boto3 S3 client を生成する (apps.users.s3_presign と同方針).

    関数内生成にすることで:
    - ``patch("apps.dm.s3_presign.boto3.client", ...)`` でテスト mock 可能
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


def public_url_for(*, s3_key: str) -> str:
    """添付ダウンロード用の公開 URL を組み立てる (CloudFront 経由 or 直 S3)."""

    custom_domain = getattr(settings, "AWS_S3_CUSTOM_DOMAIN", "") or ""
    if custom_domain:
        return f"https://{custom_domain}/{quote(s3_key)}"
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    region = settings.AWS_S3_REGION_NAME
    return f"https://{bucket}.s3.{region}.amazonaws.com/{quote(s3_key)}"
