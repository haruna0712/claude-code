"""Article image confirm サービス (#527 / Phase 6 P6-04).

presigned PUT 完了後、 S3 上の実物を ``head_object`` で再検証してから
``ArticleImage`` の orphan (article=None) を作成する。 frontend は本 service の
返却 ``ArticleImage`` の ``url`` を Markdown 本文に ``![](url)`` として埋め込む想定。

責務分離:
- 入力検証 / S3 確認 / ORM 作成 をこの module に集約する。 view 層は HTTP 変換のみ。
- DM (``apps.dm.services.confirm_attachment``) と同型の責務境界。
"""

from __future__ import annotations

import posixpath
from typing import Any

from django.contrib.auth.models import AbstractBaseUser
from django.core.exceptions import ValidationError

from apps.articles import s3_presign as _presign
from apps.articles.models import ArticleImage


def confirm_image(
    *,
    user: AbstractBaseUser,
    s3_key: str,
    filename: str,
    mime_type: str,
    size: int,
    width: int,
    height: int,
) -> ArticleImage:
    """presigned PUT 完了後の画像を確定し、 orphan ``ArticleImage`` を作成する.

    Args:
        user: アップロード実行者 (presign 時の user と一致前提、 view 層で検証済み)。
        s3_key: presign 発行時に返した key (改ざん検出のため Conditions で eq 強制済み)。
        filename: 申告ファイル名 (DB 保存はしないが拡張子検証に使う)。
        mime_type: 申告 MIME (``head_object`` の ContentType と完全一致を要求)。
        size: 申告 bytes (``head_object`` の ContentLength と完全一致を要求)。
        width: 画像の幅 (frontend が ``naturalWidth`` から取得)。
        height: 画像の高さ。

    Returns:
        作成された orphan ``ArticleImage`` (``article=None``)。

    Raises:
        ValidationError: prefix mismatch / S3 上に実物なし / metadata 不一致 /
            入力検証失敗。
    """

    # 1. s3_key prefix を再検証する。 presign 経由で生成した key だが、 独立コード経由で
    #    confirm 呼びされた場合 / フロントの key 改ざんに対する保険。
    #    ``posixpath.normpath`` で ``..`` を実際に collapse する (DM HIGH H-1 と同パターン)。
    expected_prefix = f"articles/{user.pk}/"
    normalised = posixpath.normpath(s3_key)
    if not normalised.startswith(expected_prefix):
        raise ValidationError(f"s3_key must start with '{expected_prefix}': got {s3_key!r}")

    # 2. 入力検証 (presign 経路を経ない呼びへの保険)。
    _presign.validate_image_request(mime_type=mime_type, size=size, filename=filename)

    # 3. width / height の境界。 過大値で DB / フロントが事故らないよう view 層と二重ガード。
    _validate_dimensions(width=width, height=height)

    # 4. S3 で実物を再検証。 frontend の申告は信用しない (security CRITICAL)。
    info = _presign.head_object(s3_key=s3_key)
    if info.content_length != size:
        raise ValidationError(
            f"S3 上のサイズ ({info.content_length}) が申告 ({size}) と一致しません"
        )
    # 空文字 fallback も「不一致」 として明示的に弾く (DM HIGH H-2 と同方針)。
    if info.content_type != mime_type:
        raise ValidationError(
            f"S3 上の Content-Type ({info.content_type!r}) が申告 ({mime_type!r}) と一致しません"
        )

    # 5. orphan ArticleImage を作成。 後で article 保存時に本文 URL から binding する。
    url = _presign.public_url_for(s3_key=s3_key)
    return ArticleImage.objects.create(
        article=None,
        uploader=user,
        s3_key=s3_key,
        url=url,
        width=width,
        height=height,
        size=size,
    )


def _validate_dimensions(*, width: Any, height: Any) -> None:
    """width / height の境界検証 (1..10000 の正整数)."""

    for label, value in (("width", width), ("height", height)):
        if not isinstance(value, int) or value < 1 or value > 10000:
            raise ValidationError(f"{label} must be 1..10000 (got {value!r})")
