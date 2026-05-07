"""Models for the moderation app (Phase 4B / Issues #443 #444 #446).

SPEC §14 + ER §2.12 + moderation-spec.md §2 を実装。

- ``Block``: 双方向遮断 (blocker / blockee 一方向 row だが、`is_blocked_relationship` で双方向検査)
- ``Mute``: 一方向 (muter → mutee の投稿/通知を muter から非表示)
- ``Report``: 5 対象 × 5 理由の通報、admin で resolved 管理

`apps.common.blocking.is_blocked_relationship` は Block モデルが入った瞬間
自動で活性化する (lazy-import shim)。
"""

from __future__ import annotations

import uuid

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Block(models.Model):
    """User A が User B を遮断する関係。

    - 自己 Block は CheckConstraint で禁止
    - (blocker, blockee) ペアは UniqueConstraint で 1 行
    - is_blocked_relationship が双方向検査するので、片方向 row で十分
    """

    blocker = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="blocking_set",
    )
    blockee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="blocked_by_set",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["blocker", "blockee"], name="unique_block"),
            models.CheckConstraint(check=~Q(blocker=F("blockee")), name="moderation_no_self_block"),
        ]
        indexes = [
            models.Index(fields=["blocker"], name="moderation_block_blocker_idx"),
            models.Index(fields=["blockee"], name="moderation_block_blockee_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Block(blocker={self.blocker_id}, blockee={self.blockee_id})"


class Mute(models.Model):
    """muter が mutee の投稿 / 通知を自分の view から消す一方向関係."""

    muter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="muting_set",
    )
    mutee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="muted_by_set",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["muter", "mutee"], name="unique_mute"),
            models.CheckConstraint(check=~Q(muter=F("mutee")), name="moderation_no_self_mute"),
        ]
        indexes = [
            models.Index(fields=["muter"], name="moderation_mute_muter_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Mute(muter={self.muter_id}, mutee={self.mutee_id})"


class Report(models.Model):
    """ユーザーからの通報 (SPEC §14.4).

    target_id は CharField(64) - Tweet / ThreadPost / Article / Message は
    BigAutoField (int), User は UUID なので可変長 string で受ける
    (moderation-spec §1.3 / §11)。
    """

    class Target(models.TextChoices):
        TWEET = "tweet", "ツイート"
        ARTICLE = "article", "記事"
        MESSAGE = "message", "メッセージ"
        THREAD_POST = "thread_post", "掲示板レス"
        USER = "user", "ユーザー"

    class Reason(models.TextChoices):
        SPAM = "spam", "スパム"
        ABUSE = "abuse", "誹謗中傷"
        COPYRIGHT = "copyright", "著作権侵害"
        INAPPROPRIATE = "inappropriate", "不適切コンテンツ"
        OTHER = "other", "その他"

    class Status(models.TextChoices):
        PENDING = "pending", "未対応"
        RESOLVED = "resolved", "対応済"
        DISMISSED = "dismissed", "棄却"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reports_sent",
    )
    target_type = models.CharField(max_length=20, choices=Target.choices)
    target_id = models.CharField(max_length=64)
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.TextField(max_length=1000, blank=True, default="")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reports_resolved",
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="moderation_rep_status_idx"),
            models.Index(fields=["reporter", "-created_at"], name="moderation_rep_reporter_idx"),
            models.Index(fields=["target_type", "target_id"], name="moderation_rep_target_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover
        return f"Report(id={self.pk}, target={self.target_type}:{self.target_id})"
