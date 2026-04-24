from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from djoser.serializers import UserCreateSerializer, UserSerializer
from rest_framework import serializers

from apps.users.validators import validate_handle

User = get_user_model()


class CreateUserSerializer(UserCreateSerializer):
    class Meta(UserCreateSerializer.Meta):
        model = User
        fields = ["id", "email", "username", "first_name", "last_name", "password"]

    def validate_username(self, value: str) -> str:
        """signup 時に @handle 形式・予約語チェックを行う。"""
        try:
            validate_handle(value)
        except DjangoValidationError as err:
            raise serializers.ValidationError(err.messages[0]) from err
        return value


class CustomUserSerializer(UserSerializer):
    """プロフィール表示/更新用 (self view)。

    SPEC §2 に従い username は read_only (= 変更不可) として公開する。
    ``GET /api/v1/users/me/`` および ``PATCH /api/v1/users/me/`` で使用する。
    """

    full_name = serializers.ReadOnlyField()

    class Meta(UserSerializer.Meta):
        model = User
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "full_name",
            "display_name",
            "bio",
            "avatar_url",
            "header_url",
            "is_premium",
            "needs_onboarding",
            "github_url",
            "x_url",
            "zenn_url",
            "qiita_url",
            "note_url",
            "linkedin_url",
            "date_joined",
        ]
        # username / email / is_premium は変更不可 (is_premium は Stripe webhook でのみ更新)。
        read_only_fields = [
            "id",
            "email",
            "username",
            "is_premium",
            "date_joined",
        ]


class PublicProfileSerializer(serializers.ModelSerializer):
    """公開プロフィール用 serializer (SPEC §2.2)。

    ``GET /api/v1/users/<handle>/`` で使用。未ログインでも閲覧可能。

    公開する: display_name, bio, avatar_url, header_url, SNS URL 6 種,
              @handle (username), full_name, date_joined
    公開しない: id, email, is_premium, needs_onboarding, first_name, last_name
    (= 内部 flag / PII を漏らさない)
    """

    full_name = serializers.ReadOnlyField()

    class Meta:
        model = User
        fields = [
            "username",
            "display_name",
            "bio",
            "avatar_url",
            "header_url",
            "github_url",
            "x_url",
            "zenn_url",
            "qiita_url",
            "note_url",
            "linkedin_url",
            "full_name",
            "date_joined",
        ]
        # 公開 API はすべて read_only (PATCH は /me/ 経由のみ)。
        read_only_fields = fields
