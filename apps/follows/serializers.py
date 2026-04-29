"""Follow API serializers (P2-03 / GitHub #178)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class PublicUserMiniSerializer(serializers.ModelSerializer):
    """フォロワー / フォロー中一覧の各行で返す軽量プロフィール。

    フルの PublicProfileSerializer を返すと N+1 と payload 肥大化につながるため、
    handle / display_name / avatar / followers_count のみに絞る。
    """

    handle = serializers.CharField(source="username", read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "handle",
            "display_name",
            "avatar_url",
            "bio",
            "followers_count",
        )
        read_only_fields = fields


class FollowResponseSerializer(serializers.Serializer):
    """POST /follow/ の戻り値 (idempotent: created or existing)."""

    follower = serializers.UUIDField(read_only=True)
    followee = serializers.UUIDField(read_only=True)
    created = serializers.BooleanField(read_only=True)
