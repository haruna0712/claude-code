"""DRF serializers for お気に入り (#499).

docs/specs/favorites-spec.md §4 を実装する。
"""

from __future__ import annotations

from rest_framework import serializers

from apps.boxes.models import Bookmark, Folder


class FolderSerializer(serializers.ModelSerializer):
    """Folder 出力用 (一覧 / 詳細共通)."""

    bookmark_count = serializers.IntegerField(read_only=True)
    child_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Folder
        fields = (
            "id",
            "name",
            "parent_id",
            "sort_order",
            "bookmark_count",
            "child_count",
            "created_at",
            "updated_at",
        )
        read_only_fields = (
            "id",
            "bookmark_count",
            "child_count",
            "created_at",
            "updated_at",
        )


class FolderCreateInputSerializer(serializers.Serializer):
    """``POST /folders/`` の入力."""

    name = serializers.CharField(max_length=50, min_length=1)
    parent_id = serializers.IntegerField(required=False, allow_null=True)


class FolderUpdateInputSerializer(serializers.Serializer):
    """``PATCH /folders/<id>/`` の入力 (rename / move)."""

    name = serializers.CharField(max_length=50, min_length=1, required=False)
    parent_id = serializers.IntegerField(required=False, allow_null=True)


class BookmarkSerializer(serializers.ModelSerializer):
    """Bookmark 出力 (folder 内一覧で使う)."""

    tweet_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = Bookmark
        fields = ("id", "folder_id", "tweet_id", "created_at")
        read_only_fields = fields


class BookmarkCreateInputSerializer(serializers.Serializer):
    """``POST /bookmarks/`` の入力."""

    tweet_id = serializers.IntegerField()
    folder_id = serializers.IntegerField()


class BookmarkStatusSerializer(serializers.Serializer):
    """``GET /tweets/<id>/status/`` の出力.

    folder_ids は後方互換のため残しつつ、bookmark_ids は
    ``{folder_id: bookmark_id}`` 形式で frontend が削除時に N+1 listFolderBookmarks
    せずに bookmark_id を引けるようにする (typescript-reviewer #502 H4 対応)。
    """

    folder_ids = serializers.ListField(child=serializers.IntegerField())
    # DictField の key は str に丸まるが、value も IntegerField で型を担保。
    bookmark_ids = serializers.DictField(child=serializers.IntegerField())
