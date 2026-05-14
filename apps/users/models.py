import uuid
from typing import Any

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core import validators
from django.core.validators import URLValidator
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.users.managers import UserManager
from apps.users.validators import validate_handle, validate_media_url

# SNS / アバター / ヘッダー URL には https のみ許容する (security-reviewer HIGH)。
# ftp:// / http:// を拒否する URLValidator を使い回す。
_HTTPS_URL_VALIDATOR = URLValidator(schemes=["https"])


class UsernameValidator(validators.RegexValidator):
    """互換のため残している旧正規表現バリデーター。

    ※ 新規には ``validate_handle`` を使用する。既存 migration (0001) がこの
    クラスを参照しているため残している。
    """

    regex = r"^[\w.@+-]+\Z"
    message = _(
        "Your username is not valid. A username can only contain letters, numbers, a dot, "
        "@ symbol, + symbol and a hyphen "
    )
    flag = 0


class User(AbstractUser):
    """SNS 向けに拡張された User モデル。

    SPEC §2 参照:
    - username は @handle として振る舞い、作成後は変更不可 (signals.py 参照)。
    - プロフィール拡張: display_name, bio, avatar_url, header_url
    - 課金/オンボーディング: is_premium, needs_onboarding
    - SNS リンク 6 種 (github/x/zenn/qiita/note/linkedin)
    """

    pkid = models.BigAutoField(primary_key=True, editable=False)
    id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    first_name = models.CharField(verbose_name=_("First Name"), max_length=60)
    last_name = models.CharField(verbose_name=_("Last Name"), max_length=60)
    # ``unique=True`` は PostgreSQL で UNIQUE index を自動生成するため、
    # ``db_index=True`` の併用は冗長 (database-reviewer HIGH)。
    email = models.EmailField(verbose_name=_("Email Address"), unique=True)
    username = models.CharField(
        verbose_name=_("Username"),
        max_length=30,
        unique=True,
        validators=[validate_handle],
        help_text=_("Public @handle. 3-30 chars, alphanumeric and underscore only. Immutable."),
    )

    # ---- プロフィール (SPEC §2) ----
    display_name = models.CharField(
        verbose_name=_("Display Name"),
        max_length=50,
        blank=True,
        default="",
    )
    bio = models.CharField(
        verbose_name=_("Bio"),
        max_length=160,
        blank=True,
        default="",
        help_text=_("Plain text only. Markdown is NOT rendered."),
    )
    # code-reviewer (PR #139 HIGH #2): avatar_url / header_url は許可ドメインに制限。
    # validate_media_url は model validation (full_clean / admin) でも効く。
    avatar_url = models.URLField(
        verbose_name=_("Avatar URL"),
        max_length=500,
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR, validate_media_url],
        help_text=_("S3 URL to the user's avatar image. Must be https://."),
    )
    header_url = models.URLField(
        verbose_name=_("Header URL"),
        max_length=500,
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR, validate_media_url],
        help_text=_("S3 URL to the user's header image. Must be https://."),
    )

    # ---- カウンタ (P2-03: signals で transaction.on_commit + reconciliation Beat) ----
    # database-reviewer HIGH (db H-1): post_save / post_delete signals は commit 前に
    # 発火するためロールバックで drift する。 ``apps/follows/signals.py`` では
    # ``transaction.on_commit`` でコミット後に ``F() + 1 / - 1`` を発行する。
    # ``GREATEST(... - 1, 0)`` ガードを入れた reconciliation Beat も併設する。
    followers_count = models.PositiveIntegerField(
        verbose_name=_("Followers Count"),
        default=0,
        help_text=_("Number of users following this user (denormalized via Follow signals)."),
    )
    following_count = models.PositiveIntegerField(
        verbose_name=_("Following Count"),
        default=0,
        help_text=_("Number of users this user follows."),
    )

    # ---- #735 鍵アカ (非公開アカウント) ----
    # spec: docs/specs/private-account-spec.md §2.1
    # True にすると新規 follow が承認制 (Follow.status=pending) になり、
    # 既存 follower は維持される。 鍵アカ user の tweet は承認済み follower
    # + 本人のみ閲覧可能 (Tweet.objects.visible_to(viewer) で判定)。
    is_private = models.BooleanField(
        verbose_name=_("Is Private (鍵アカ)"),
        default=False,
        help_text=_(
            "Whether this account is private. New follow requests require "
            "approval, and only approved followers can see this user's tweets."
        ),
    )

    # ---- 課金 / オンボーディング ----
    is_premium = models.BooleanField(
        verbose_name=_("Is Premium"),
        default=False,
        help_text=_("Set by Stripe webhook in Phase 8."),
    )
    needs_onboarding = models.BooleanField(
        verbose_name=_("Needs Onboarding"),
        default=True,
        help_text=_("Flipped to False once the onboarding flow (P1-14) completes."),
    )

    # ---- SNS リンク ----
    # python-reviewer HIGH (DJ001): CharField/URLField の null=True は避け、
    # 空値は "" で統一する。security-reviewer HIGH: https のみ許容。
    github_url = models.URLField(
        verbose_name=_("GitHub URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )
    x_url = models.URLField(
        verbose_name=_("X (Twitter) URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )
    zenn_url = models.URLField(
        verbose_name=_("Zenn URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )
    qiita_url = models.URLField(
        verbose_name=_("Qiita URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )
    note_url = models.URLField(
        verbose_name=_("note URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )
    linkedin_url = models.URLField(
        verbose_name=_("LinkedIn URL"),
        blank=True,
        default="",
        validators=[_HTTPS_URL_VALIDATOR],
    )

    # ---- P13-04: 翻訳設定 (Phase 13 自動翻訳機能) ----
    # UI 表示言語 (ISO 639-1)。 default は ja (日本語話者向け SNS)。
    # 翻訳 button の表示判定: tweet.language != user.preferred_language なら表示。
    # choices で固定 list に絞ることで、 不正値 (xx 等) や frontend 側の typo を
    # 弾く + Admin で select に出る (UX)。 spec: docs/specs/auto-translate-spec.md §4.2
    PREFERRED_LANGUAGE_CHOICES = (
        ("ja", "日本語"),
        ("en", "English"),
        ("ko", "한국어"),
        ("zh-cn", "简体中文"),
        ("es", "Español"),
        ("fr", "Français"),
        ("pt", "Português"),
    )
    preferred_language = models.CharField(
        verbose_name=_("Preferred Language"),
        max_length=8,
        choices=PREFERRED_LANGUAGE_CHOICES,
        default="ja",
        help_text=_("UI display language and default translation target."),
    )
    # グローバル auto translate (default False、 X / Twitter と同じ opt-in)。
    # ON のときは tweet.language != user.preferred_language の TL 表示で
    # 自動的に翻訳済みに切り替わる (P13-07)。
    auto_translate = models.BooleanField(
        verbose_name=_("Auto Translate"),
        default=False,
        help_text=_("Automatically translate foreign-language tweets on render."),
    )

    EMAIL_FIELD = "email"
    USERNAME_FIELD = "email"

    REQUIRED_FIELDS = ["username", "first_name", "last_name"]

    objects = UserManager()

    class Meta:
        verbose_name = _("User")
        verbose_name_plural = _("Users")
        ordering = ["-date_joined"]
        # NOTE (database-reviewer HIGH): ``username`` は ``unique=True`` により
        # PostgreSQL が自動で UNIQUE index を張る。明示的な ``Index(fields=["username"])``
        # は完全に重複するため削除した。``-date_joined`` はソート/フィード用途で
        # 独立したインデックスが必要なため残す。``name=`` を明示して命名 drift を防ぐ。
        indexes = [
            models.Index(fields=["-date_joined"], name="users_joined_desc_idx"),
        ]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        # username 変更拒否用の snapshot (signals.py で参照)。
        self._original_username: str | None = self.username

    @classmethod
    def from_db(cls, db: Any, field_names: Any, values: Any) -> "User":
        instance = super().from_db(db, field_names, values)
        instance._original_username = instance.username
        return instance

    @property
    def full_name(self) -> str:
        """表示用のフルネーム (read-only プロパティ)。

        ``AbstractUser.get_full_name()`` を上書き (shadow) しないよう、あえて
        別名 ``full_name`` として公開する (python-reviewer HIGH)。
        """
        return f"{self.first_name} {self.last_name}".strip()


# --- Phase 12 (P12-01): UserResidence ---


class UserResidence(models.Model):
    """User の居住地 (Phase 12 P12-01)。

    プライバシー配慮で **必ず円** で表現 (ピンポイント禁止)。 最低半径は 500m。
    proximity 検索は haversine SQL で計算 (PostGIS 不要、 MVP 規模)。

    spec: 「ユーザーが住所をざっくり示せる」 + 「ピンポイント公開は防ぐ (min 500m)」。
    """

    MIN_RADIUS_M = 500
    MAX_RADIUS_M = 50_000  # 50km cap (それ以上は意味なし)

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="residence",
    )
    # WGS84 (世界測地系) で lat/lng を保存。 precision 7 = 1.1cm 単位だが、
    # 個人居住地はそんなに精密に保存しないので precision 6 (11cm) で十分。
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    # 半径 (メートル)。 MIN_RADIUS_M 以上必須 (validator + serializer 二重 enforce)。
    radius_m = models.PositiveIntegerField(default=MIN_RADIUS_M)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=models.Q(latitude__gte=-90, latitude__lte=90),
                name="user_residence_lat_range",
            ),
            models.CheckConstraint(
                check=models.Q(longitude__gte=-180, longitude__lte=180),
                name="user_residence_lng_range",
            ),
            models.CheckConstraint(
                check=models.Q(radius_m__gte=500, radius_m__lte=50_000),
                name="user_residence_radius_range",
            ),
        ]

    def __str__(self) -> str:
        return f"UserResidence(user={self.user_id}, ({self.latitude},{self.longitude}) r={self.radius_m}m)"
