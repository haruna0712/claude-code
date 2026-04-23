import uuid
from typing import Any

from django.contrib.auth.models import AbstractUser
from django.core import validators
from django.db import models
from django.utils.translation import gettext_lazy as _

from apps.users.managers import UserManager
from apps.users.validators import validate_handle


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
    email = models.EmailField(verbose_name=_("Email Address"), unique=True, db_index=True)
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
    avatar_url = models.CharField(
        verbose_name=_("Avatar URL"),
        max_length=500,
        blank=True,
        default="",
        help_text=_("S3 URL to the user's avatar image."),
    )
    header_url = models.CharField(
        verbose_name=_("Header URL"),
        max_length=500,
        blank=True,
        default="",
        help_text=_("S3 URL to the user's header image."),
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
    github_url = models.URLField(
        verbose_name=_("GitHub URL"),
        null=True,
        blank=True,
    )
    x_url = models.URLField(
        verbose_name=_("X (Twitter) URL"),
        null=True,
        blank=True,
    )
    zenn_url = models.URLField(
        verbose_name=_("Zenn URL"),
        null=True,
        blank=True,
    )
    qiita_url = models.URLField(
        verbose_name=_("Qiita URL"),
        null=True,
        blank=True,
    )
    note_url = models.URLField(
        verbose_name=_("note URL"),
        null=True,
        blank=True,
    )
    linkedin_url = models.URLField(
        verbose_name=_("LinkedIn URL"),
        null=True,
        blank=True,
    )

    EMAIL_FIELD = "email"
    USERNAME_FIELD = "email"

    REQUIRED_FIELDS = ["username", "first_name", "last_name"]

    objects = UserManager()

    class Meta:
        verbose_name = _("User")
        verbose_name_plural = _("Users")
        ordering = ["-date_joined"]
        indexes = [
            models.Index(fields=["username"], name="users_username_idx"),
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
    def get_full_name(self) -> str:
        full_name = f"{self.first_name} {self.last_name}"
        return full_name.strip()
