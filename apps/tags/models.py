"""Models for the tags app (P1-05).

SPEC §4 準拠:
    - name は小文字正規化の一意 slug (URL / ハッシュタグ検索のキー)
    - display_name は表示用 (大小混在: `TypeScript`, `Next.js` など)
    - is_approved はモデレータ承認フラグ。未承認タグの公開は P1-06 側で制御
    - usage_count は tweets 側 (P1-07) の post_save シグナルからキャッシュ更新予定

ここでは他 worktree と完全独立に動かせるよう、Tag モデル単体のみを提供する。
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class Tag(models.Model):
    """技術タグ.

    SPEC §4:
        - name: 小文字正規化された一意 slug (検索・URL 用)
        - display_name: 表示用文字列 (大小混在)
        - description: 管理画面から付与される説明
        - created_by: 初回提案ユーザー (システムシード投入時は NULL)
        - is_approved: モデレータ承認フラグ。承認済のみ全文検索 / 候補提示対象
        - usage_count: tweets 側から更新するキャッシュカウンタ (P1-07)
    """

    name = models.CharField(
        verbose_name=_("tag name (lowercase slug)"),
        max_length=50,
        unique=True,
        help_text=_("Lowercase unique slug. Normalized on save."),
    )
    display_name = models.CharField(
        verbose_name=_("display name"),
        max_length=50,
        help_text=_("Human-readable display form (mixed case allowed, e.g. 'TypeScript')."),
    )
    description = models.TextField(
        verbose_name=_("description"),
        blank=True,
        help_text=_("Optional description curated by moderators."),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name=_("created by"),
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="proposed_tags",
        help_text=_("User who first proposed the tag. NULL for system-seeded tags."),
    )
    is_approved = models.BooleanField(
        verbose_name=_("is approved"),
        default=False,
        help_text=_("Whether a moderator has approved this tag for public use."),
    )
    usage_count = models.PositiveIntegerField(
        verbose_name=_("usage count"),
        default=0,
        help_text=_("Number of tweets referencing this tag (cached, updated by P1-07)."),
    )

    class Meta:
        verbose_name = _("Tag")
        verbose_name_plural = _("Tags")
        # 人気タグを先頭に、同率は name 昇順で安定化
        ordering = ["-usage_count", "name"]
        indexes = [
            models.Index(fields=["name"]),
            models.Index(fields=["-usage_count"]),
        ]

    def __str__(self) -> str:
        return self.display_name

    def save(self, *args, **kwargs) -> None:
        """name を小文字へ正規化してから保存する."""
        # None を渡されるケースは CharField 的に想定外だが、防御として type check
        if self.name:
            self.name = self.name.lower()
        super().save(*args, **kwargs)
