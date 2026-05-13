from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from djoser.serializers import UserCreateSerializer, UserSerializer
from rest_framework import serializers

from apps.users.models import UserResidence
from apps.users.s3_presign import ALLOWED_CONTENT_TYPES, MAX_CONTENT_LENGTH
from apps.users.validators import validate_handle, validate_media_url

# Serializer レベルで URL のスキームを https に限定する validator。
# djoser UserSerializer を継承している都合で model validators が拾われないため、
# extra_kwargs で再注入する (apps/users/models.py の _HTTPS_URL_VALIDATOR と同等)。
_HTTPS_URL_VALIDATOR = URLValidator(schemes=["https"])

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

    # P3 fix: bigint pkid を露出する。User.id は UUID (公開用)、`pkid` は内部 BigAutoField
    # (DM serializer の user_id / sender_id / creator_id と一致する番号)。フロントエンドが
    # `currentUserId` として比較するために必要。
    pkid = serializers.IntegerField(read_only=True)

    class Meta(UserSerializer.Meta):
        model = User
        fields = [
            "id",
            "pkid",
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
        # needs_onboarding もクライアント側からは変更不可 — オンボーディング完了判定は
        # サーバー側 (signal / dedicated endpoint) でのみ更新する (P1-03 review MEDIUM 対応)。
        read_only_fields = [
            "id",
            "pkid",
            "email",
            "username",
            "is_premium",
            "needs_onboarding",
            "date_joined",
        ]
        # djoser UserSerializer 継承時 model field の URLValidator(schemes=["https"]) が
        # 自動取り込みされないため、extra_kwargs で各 SNS URL に明示的に再注入する
        # (security-reviewer #131 既知問題の類似パターン対応)。
        # avatar_url / header_url は追加で validate_media_url で許可ドメインに制限する
        # (code-reviewer PR #139 HIGH #2)。
        extra_kwargs = {
            "github_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "x_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "zenn_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "qiita_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "note_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "linkedin_url": {"validators": [_HTTPS_URL_VALIDATOR]},
            "avatar_url": {"validators": [_HTTPS_URL_VALIDATOR, validate_media_url]},
            "header_url": {"validators": [_HTTPS_URL_VALIDATOR, validate_media_url]},
        }


class UploadUrlRequestSerializer(serializers.Serializer):
    """avatar / header アップロード URL 発行リクエストの検証用 serializer (P1-04).

    ``POST /api/v1/users/me/avatar-upload-url/`` などで使用。
    - ``content_type`` は WebP / JPEG / PNG のみ許可 (white list)。
    - ``content_length`` は 1 以上 5 MiB 以下。
    choices / min_value / max_value は s3_presign 側の定数から生成し、
    真実の source を 1 箇所に保つ (定数再定義によるドリフトを防止)。
    """

    content_type = serializers.ChoiceField(choices=sorted(ALLOWED_CONTENT_TYPES))
    content_length = serializers.IntegerField(min_value=1, max_value=MAX_CONTENT_LENGTH)


class PublicProfileSerializer(serializers.ModelSerializer):
    """公開プロフィール用 serializer (SPEC §2.2)。

    ``GET /api/v1/users/<handle>/`` で使用。未ログインでも閲覧可能。

    公開する: display_name, bio, avatar_url, header_url, SNS URL 6 種,
              @handle (username), full_name, date_joined,
              is_following (#296: ログイン中なら閲覧者がこの handle を follow 中か)
    公開しない: id, email, is_premium, needs_onboarding, first_name, last_name
    (= 内部 flag / PII を漏らさない)
    """

    full_name = serializers.ReadOnlyField()
    # #296: FollowButton の初期状態判定用。ログイン中の閲覧者が target handle を
    # フォローしているか。未ログイン時 / 自分自身 / target 不在は false。
    # 1 query (Follow.objects.filter(...).exists()) で済むので N+1 リスク無し。
    is_following = serializers.SerializerMethodField()

    # Phase 4B (#448): ProfileKebab の初期状態判定用。
    is_blocking = serializers.SerializerMethodField()
    is_muting = serializers.SerializerMethodField()
    # Phase 4B (#449): ReportDialog で target_id (UUID) として送る。
    user_id = serializers.UUIDField(source="id", read_only=True)

    def get_is_following(self, obj: User) -> bool:
        request = self.context.get("request")
        if not request or not getattr(request, "user", None):
            return False
        viewer = request.user
        if not viewer.is_authenticated or viewer.pk == obj.pk:
            return False
        # circular import 回避のため遅延 import (apps.follows は users に依存)
        from apps.follows.models import Follow

        return Follow.objects.filter(follower=viewer, followee=obj).exists()

    def get_is_blocking(self, obj: User) -> bool:
        request = self.context.get("request")
        viewer = getattr(request, "user", None) if request else None
        if viewer is None or not getattr(viewer, "is_authenticated", False) or viewer.pk == obj.pk:
            return False
        try:
            from apps.moderation.models import Block
        except ImportError:
            return False
        return Block.objects.filter(blocker=viewer, blockee=obj).exists()

    def get_is_muting(self, obj: User) -> bool:
        request = self.context.get("request")
        viewer = getattr(request, "user", None) if request else None
        if viewer is None or not getattr(viewer, "is_authenticated", False) or viewer.pk == obj.pk:
            return False
        try:
            from apps.moderation.models import Mute
        except ImportError:
            return False
        return Mute.objects.filter(muter=viewer, mutee=obj).exists()

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
            "is_following",
            # Phase 4B (#448 #449): ProfileKebab / ReportDialog の初期状態
            "is_blocking",
            "is_muting",
            "user_id",
            # #421: フォロー数 / フォロワー数 (X 風プロフィール表示)
            "followers_count",
            "following_count",
        ]
        # 公開 API はすべて read_only (PATCH は /me/ 経由のみ)。
        # ``fields`` と同じ list を参照させると、DRF 内部で片方に mutate が走った
        # ときに他方まで壊れる可能性がある。独立コピーを持たせる
        # (P1-03 review HIGH 対応)。
        read_only_fields = list(fields)


# ---------------------------------------------------------------------------
# Phase 12 P12-01: UserResidence (居住地マップ) — プライバシー保護のため
# サーバ側で min 500m radius を二重 enforce する。
# ---------------------------------------------------------------------------


class UserResidenceSerializer(serializers.ModelSerializer):
    """UserResidence の読み出し用 (anon でも公開可)。

    ``latitude`` / ``longitude`` は数値 (Decimal) で返す。 frontend は Leaflet に
    そのまま渡せる。 ``radius_m`` は常に MIN_RADIUS_M 以上を満たすので、
    クライアントは生値を信頼してよい。
    """

    class Meta:
        model = UserResidence
        fields = ["latitude", "longitude", "radius_m", "updated_at"]
        read_only_fields = list(fields)


_LAT_MIN = Decimal("-90")
_LAT_MAX = Decimal("90")
_LNG_MIN = Decimal("-180")
_LNG_MAX = Decimal("180")


class UserResidenceWriteSerializer(serializers.ModelSerializer):
    """``PATCH /api/v1/users/me/residence/`` 用の書き込み serializer。

    min 500m radius と lat/lng レンジを **serializer + model CheckConstraint** の
    二重で enforce する (security-reviewer 観点でクライアント側の slider min を
    弄って 1m radius にすり抜けられないように)。
    """

    latitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, min_value=_LAT_MIN, max_value=_LAT_MAX
    )
    longitude = serializers.DecimalField(
        max_digits=9, decimal_places=6, min_value=_LNG_MIN, max_value=_LNG_MAX
    )
    radius_m = serializers.IntegerField(
        min_value=UserResidence.MIN_RADIUS_M,
        max_value=UserResidence.MAX_RADIUS_M,
    )

    class Meta:
        model = UserResidence
        fields = ["latitude", "longitude", "radius_m"]
