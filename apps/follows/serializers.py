"""Follow API serializers (P2-03 / GitHub #178)."""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

User = get_user_model()


class PublicUserMiniSerializer(serializers.ModelSerializer):
    """フォロワー / フォロー中一覧の各行で返す軽量プロフィール。

    `is_following` は request.user 視点で行 user を follow しているか
    (#423: 一覧の「フォロー」/「フォロー解除」ボタン状態を初期反映するため)。
    """

    handle = serializers.CharField(source="username", read_only=True)
    is_following = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "handle",
            "display_name",
            "avatar_url",
            "bio",
            "followers_count",
            "is_following",
        )
        read_only_fields = fields

    def get_is_following(self, obj: User) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        if request.user.pk == obj.pk:
            return False
        from apps.follows.models import Follow

        return Follow.objects.filter(follower=request.user, followee=obj).exists()


class FollowResponseSerializer(serializers.Serializer):
    """POST /follow/ の戻り値 (idempotent: created or existing)。

    #735: ``status`` を含める (= 公開アカなら ``"approved"``、 鍵アカなら
    ``"pending"``)。 frontend FollowButton が 3 状態 (承認待ち / フォロー中 /
    フォローする) を切り替えるために使う。
    """

    follower = serializers.UUIDField(read_only=True)
    followee = serializers.UUIDField(read_only=True)
    created = serializers.BooleanField(read_only=True)
    status = serializers.CharField(read_only=True)
