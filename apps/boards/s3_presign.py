"""S3 presigned URL 発行 (Phase 5 / Issue #430).

apps.users.s3_presign の boards 版。プレフィックスは ``thread_posts/<yyyy>/<mm>/``。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Final

import boto3
from botocore.client import Config as BotoConfig
from django.conf import settings
from django.core.exceptions import ValidationError

ALLOWED_CONTENT_TYPES: Final[dict[str, str]] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

#: 1 ファイルあたり最大 5MiB (SPEC §11.2)。
MAX_CONTENT_LENGTH: Final[int] = 5 * 1024 * 1024

#: presigned URL 有効期間 15 分。
PRESIGN_EXPIRES_SECONDS: Final[int] = 15 * 60


@dataclass(frozen=True)
class PresignedUpload:
    upload_url: str
    object_key: str
    expires_at: datetime
    public_url: str

    def to_dict(self) -> dict[str, str]:
        return {
            "upload_url": self.upload_url,
            "object_key": self.object_key,
            "expires_at": self.expires_at.isoformat(),
            "public_url": self.public_url,
        }


def validate_upload_request(content_type: str, content_length: int) -> None:
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise ValidationError(
            f"Unsupported content_type: {content_type!r}. "
            f"Allowed: {sorted(ALLOWED_CONTENT_TYPES)}"
        )
    if content_length <= 0:
        raise ValidationError("content_length must be positive")
    if content_length > MAX_CONTENT_LENGTH:
        raise ValidationError(
            f"content_length {content_length} exceeds maximum {MAX_CONTENT_LENGTH} bytes"
        )


def generate_thread_post_image_upload_url(
    user_id: int,
    content_type: str,
    content_length: int,
    *,
    now: datetime | None = None,
) -> PresignedUpload:
    """ThreadPost 画像用の presigned PUT URL を発行する.

    object key 形式: ``thread_posts/<yyyy>/<mm>/<user_id>-<uuid>.<ext>``
    """
    validate_upload_request(content_type, content_length)
    ext = ALLOWED_CONTENT_TYPES[content_type]
    now = now or datetime.now(tz=UTC)
    object_key = f"thread_posts/{now.year:04d}/{now.month:02d}/" f"{user_id}-{uuid.uuid4()}.{ext}"
    bucket = settings.AWS_STORAGE_BUCKET_NAME
    region = settings.AWS_S3_REGION_NAME

    s3_client = boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID or None,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY or None,
        config=BotoConfig(
            signature_version=getattr(settings, "AWS_S3_SIGNATURE_VERSION", "s3v4"),
            s3={"addressing_style": getattr(settings, "AWS_S3_ADDRESSING_STYLE", "virtual")},
        ),
    )

    upload_url = s3_client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": bucket,
            "Key": object_key,
            "ContentType": content_type,
            "ContentLength": content_length,
        },
        ExpiresIn=PRESIGN_EXPIRES_SECONDS,
        HttpMethod="PUT",
    )

    expires_at = now + timedelta(seconds=PRESIGN_EXPIRES_SECONDS)
    public_url = _build_public_url(bucket=bucket, object_key=object_key)
    return PresignedUpload(
        upload_url=upload_url,
        object_key=object_key,
        expires_at=expires_at,
        public_url=public_url,
    )


def _build_public_url(*, bucket: str, object_key: str) -> str:
    custom_domain = getattr(settings, "AWS_S3_CUSTOM_DOMAIN", "") or ""
    if custom_domain:
        return f"https://{custom_domain}/{object_key}"
    region = settings.AWS_S3_REGION_NAME
    return f"https://{bucket}.s3.{region}.amazonaws.com/{object_key}"
