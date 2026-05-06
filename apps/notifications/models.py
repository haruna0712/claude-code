"""Notification models (#412 / Phase 4A).

ER.md §2.13 / SPEC.md §8 / docs/specs/notifications-spec.md 参照。

10 種別 (LIKE/REPOST/QUOTE/REPLY/MENTION/DM_*/FOLLOW/ARTICLE_*) の通知を
recipient (= self) ごとに保持する。本 Issue (#412) では LIKE/REPOST/QUOTE/
REPLY/MENTION/FOLLOW の 6 種を発火、DM_* / ARTICLE_* は enum 予約のみ。

target は GenericForeignKey を使わず ``target_type:str + target_id:str`` の
自前 generic ref。ContentType join のオーバーヘッドを避けつつ、Tweet (int pk)
と User (UUID/int 両方持ち) を統一して扱える。
"""

from __future__ import annotations

import uuid as _uuid

from django.conf import settings
from django.db import models


class NotificationKind(models.TextChoices):
    """通知の種別 (ER §2.13)."""

    LIKE = "like"
    REPOST = "repost"
    QUOTE = "quote"
    REPLY = "reply"
    MENTION = "mention"
    DM_MESSAGE = "dm_message"
    DM_INVITE = "dm_invite"
    FOLLOW = "follow"
    ARTICLE_COMMENT = "article_comment"
    ARTICLE_LIKE = "article_like"


class Notification(models.Model):
    """通知 (#412)."""

    id = models.UUIDField(primary_key=True, default=_uuid.uuid4, editable=False)
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    kind = models.CharField(max_length=30, choices=NotificationKind.choices)

    # 自前 generic ref (#412)。Tweet は int pk、User は UUID id を持つので
    # CharField(64) で string 統一する。serializer 側で in_bulk 解決。
    target_type = models.CharField(max_length=30, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")

    read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # 一覧 + unread-count
            models.Index(fields=["recipient", "read", "-created_at"]),
            # dedup クエリ専用 (architect MED): create-time check を carbide にカバー
            models.Index(
                fields=[
                    "recipient",
                    "actor",
                    "kind",
                    "target_type",
                    "target_id",
                    "-created_at",
                ],
                name="notif_dedup_idx",
            ),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:  # pragma: no cover - debug repr
        return f"Notification(id={self.pk}, kind={self.kind}, recipient={self.recipient_id})"
