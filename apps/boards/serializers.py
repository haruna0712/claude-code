"""DRF serializers for boards (Phase 5).

すべて関連 spec: docs/specs/boards-spec.md §3
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from rest_framework import serializers

from apps.boards.models import Board, Thread, ThreadPost, ThreadPostImage
from apps.boards.services import (
    THREAD_POST_MAX_IMAGES,
    compute_thread_state,
)

#: hex 色 `#rrggbb` (大文字小文字どちらも許可)
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


#: 投稿に attach できる image_url のホスト名 (S3 か CloudFront カスタムドメイン)。
def _allowed_image_hosts() -> set[str]:
    hosts: set[str] = set()
    bucket = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "") or ""
    region = getattr(settings, "AWS_S3_REGION_NAME", "") or ""
    if bucket and region:
        hosts.add(f"{bucket}.s3.{region}.amazonaws.com")
        hosts.add(f"{bucket}.s3.amazonaws.com")
    custom = getattr(settings, "AWS_S3_CUSTOM_DOMAIN", "") or ""
    if custom:
        hosts.add(custom)
    return hosts


def _validate_image_host(url: str) -> None:
    """`image_url` が S3 / CloudFront 内のものであることを確認する.

    AWS 設定が空 (テスト環境) のときは host チェックをスキップする。
    """
    hosts = _allowed_image_hosts()
    if not hosts:
        return
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise serializers.ValidationError("image_url must be https")
    if parsed.netloc not in hosts:
        raise serializers.ValidationError(f"image_url host must be one of {sorted(hosts)}")


# ---------------------------------------------------------------------------
# 出力 (read) 用
# ---------------------------------------------------------------------------


class _AuthorMiniSerializer(serializers.Serializer):
    """投稿者・スレ作成者の最低限の表示要素."""

    handle = serializers.CharField(source="username", read_only=True)
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    def get_display_name(self, obj: Any) -> str:
        return getattr(obj, "display_name", "") or obj.username

    def get_avatar_url(self, obj: Any) -> str:
        return getattr(obj, "avatar_url", "") or ""


class BoardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Board
        fields = ["slug", "name", "description", "order", "color"]
        read_only_fields = fields

    def validate_color(self, value: str) -> str:
        # python-reviewer HIGH #2: HEX_COLOR_RE を実適用する。
        # 現状は admin が write 経路だが、color を validation せず入れると
        # フロントの Tailwind class 適用箇所で予期しない値が出る。
        if not HEX_COLOR_RE.match(value):
            raise serializers.ValidationError(
                "color は #rrggbb 形式 (16 進 6 桁) で指定してください。"
            )
        return value


class ThreadPostImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ThreadPostImage
        fields = ["image_url", "width", "height", "order"]


class ThreadPostSerializer(serializers.ModelSerializer):
    """ThreadPost 出力。論理削除済は body / images / author を redact する."""

    author = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()

    class Meta:
        model = ThreadPost
        fields = [
            "id",
            "thread",
            "number",
            "author",
            "body",
            "images",
            "is_deleted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_author(self, obj: ThreadPost) -> dict[str, Any] | None:
        if obj.is_deleted or obj.author is None:
            return None
        return _AuthorMiniSerializer(obj.author).data

    def get_images(self, obj: ThreadPost) -> list[dict[str, Any]]:
        if obj.is_deleted:
            return []
        return ThreadPostImageSerializer(obj.images.all(), many=True).data

    def get_body(self, obj: ThreadPost) -> str:
        if obj.is_deleted:
            return ""
        return obj.body


class ThreadSerializer(serializers.ModelSerializer):
    """Thread 出力 (一覧 / 詳細共通)."""

    author = serializers.SerializerMethodField()
    board = serializers.SlugRelatedField(slug_field="slug", read_only=True)

    class Meta:
        model = Thread
        fields = [
            "id",
            "board",
            "title",
            "author",
            "post_count",
            "last_post_at",
            "locked",
            "is_deleted",
            "created_at",
        ]
        read_only_fields = fields

    def get_author(self, obj: Thread) -> dict[str, Any] | None:
        if obj.author is None:
            return None
        return _AuthorMiniSerializer(obj.author).data


class ThreadDetailSerializer(ThreadSerializer):
    """スレ詳細 (一覧と同じ shape、後方互換のため別名で公開)."""


# ---------------------------------------------------------------------------
# 入力 (write) 用
# ---------------------------------------------------------------------------


class _ImageInputSerializer(serializers.Serializer):
    image_url = serializers.URLField(max_length=512)
    width = serializers.IntegerField(min_value=1)
    height = serializers.IntegerField(min_value=1)
    order = serializers.IntegerField(min_value=0, max_value=THREAD_POST_MAX_IMAGES - 1)

    def validate_image_url(self, value: str) -> str:
        _validate_image_host(value)
        return value


class ThreadCreateSerializer(serializers.Serializer):
    """スレ作成: title + 1 レス目 (body + 0..4 image)."""

    title = serializers.CharField(max_length=100, allow_blank=False)
    first_post_body = serializers.CharField(max_length=5000, allow_blank=False)
    first_post_images = _ImageInputSerializer(many=True, required=False, default=list)

    def validate_first_post_images(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(value) > THREAD_POST_MAX_IMAGES:
            raise serializers.ValidationError(f"画像は最大 {THREAD_POST_MAX_IMAGES} 枚までです。")
        # order 重複チェック
        orders = [img["order"] for img in value]
        if len(orders) != len(set(orders)):
            raise serializers.ValidationError("画像の order が重複しています。")
        return value


class ThreadPostCreateSerializer(serializers.Serializer):
    """レス作成: body + 0..4 image."""

    body = serializers.CharField(max_length=5000, allow_blank=False)
    images = _ImageInputSerializer(many=True, required=False, default=list)

    def validate_images(self, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if len(value) > THREAD_POST_MAX_IMAGES:
            raise serializers.ValidationError(f"画像は最大 {THREAD_POST_MAX_IMAGES} 枚までです。")
        orders = [img["order"] for img in value]
        if len(orders) != len(set(orders)):
            raise serializers.ValidationError("画像の order が重複しています。")
        return value


class ImageUploadUrlSerializer(serializers.Serializer):
    """presigned PUT URL 発行リクエスト."""

    content_type = serializers.CharField()
    content_length = serializers.IntegerField(min_value=1)


# ---------------------------------------------------------------------------
# 出力ヘルパ
# ---------------------------------------------------------------------------


def serialize_thread_state(thread: Thread) -> dict[str, Any]:
    """API レスポンスに含める ``thread_state`` を組み立てる."""
    return compute_thread_state(post_count=thread.post_count, locked=thread.locked)
