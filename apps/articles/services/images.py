"""Article image confirm サービス (#527 / Phase 6 P6-04).

presigned POST で S3 へのアップロード完了後、 実物を ``head_object`` で再検証してから
``ArticleImage`` の orphan (article=None) を作成する。 frontend は本 service の返却
``ArticleImage`` の ``url`` を Markdown 本文に ``![](url)`` として埋め込む想定。

責務分離:
- 入力検証 / S3 確認 / ORM 作成 をこの module に集約する。 view 層は HTTP 変換のみ。
- DM (``apps.dm.services.confirm_attachment``) と同型の責務境界。
"""

from __future__ import annotations

import posixpath

from django.contrib.auth.models import AbstractBaseUser
from django.core.exceptions import ValidationError
from django.db import transaction

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
    """presigned POST 完了後の画像を確定し、 orphan ``ArticleImage`` を作成する.

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
        ValidationError: prefix mismatch / s3_key 内に traversal 表記 / S3 上に実物なし /
            metadata 不一致 / 入力検証失敗。
    """

    # 1. s3_key prefix を再検証する。 presign 経由で生成した key だが、 独立コード経由で
    #    confirm 呼びされた場合 / フロントの key 改ざんに対する保険。
    #    ``posixpath.normpath`` で ``..`` を実際に collapse し、 元の入力と一致しなければ拒否
    #    (S3 はキーをリテラル文字列として扱うので、 ``articles/1/../1/foo`` のような形を
    #    DB に書き込まないようにする)。
    expected_prefix = f"article-images/{user.pk}/"
    normalised = posixpath.normpath(s3_key)
    if normalised != s3_key:
        raise ValidationError(
            f"s3_key contains path traversal or non-canonical sequences: {s3_key!r}"
        )
    if not normalised.startswith(expected_prefix):
        raise ValidationError(f"s3_key must start with '{expected_prefix}': got {s3_key!r}")

    # 2. 入力検証 (presign 経路を経ない呼びへの保険)。
    _presign.validate_image_request(mime_type=mime_type, size=size, filename=filename)

    # 3. width / height の境界。 過大値で DB / フロントが事故らないよう view 層と二重ガード。
    _validate_dimensions(width=width, height=height)

    # 4. S3 で実物を再検証。 frontend の申告は信用しない (security CRITICAL)。
    #
    # NOTE (database-reviewer L-1): head_object (外部 I/O) と ArticleImage.create
    # は ``transaction.atomic`` で包んでいない。 head_object 完了後に DB insert が
    # 失敗した場合、 S3 上に object が残るが DB row が無い「孤立 S3 object」 になる。
    # これは presign 発行 → S3 PUT 成功 → confirm 失敗 (size mismatch 等) と同じ
    # 結果で、 S3 lifecycle rule (365 日、 follow-up issue) で最終的に回収される。
    # atomic で包むと head_object の I/O 待ちの間 DB connection を保持してしまう
    # ため意図的に外している。
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
    # database-reviewer H-1: unique(s3_key) で同一 key 二重 confirm 時 IntegrityError
    # が走るが、 outer の implicit transaction を broken state にしないため
    # transaction.atomic で savepoint を切る (caller は IntegrityError を catch して
    # 400 に変換できる)。
    url = _presign.public_url_for(s3_key=s3_key)
    with transaction.atomic():
        return ArticleImage.objects.create(
            article=None,
            uploader=user,
            s3_key=s3_key,
            url=url,
            width=width,
            height=height,
            size=size,
        )


def _validate_dimensions(*, width: int, height: int) -> None:
    """width / height の境界検証 (1..10000 の正整数).

    serializer 側で同等の検証を行うが、 service が他経路から直接呼ばれた場合の保険。
    ``isinstance(value, bool)`` を先に弾く: Python は ``bool`` を ``int`` のサブクラスに
    しているため ``True`` / ``False`` が通過しないように明示する。
    """

    for label, value in (("width", width), ("height", height)):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(f"{label} must be int (got {type(value).__name__})")
        if value < 1 or value > 10000:
            raise ValidationError(f"{label} must be 1..10000 (got {value!r})")
