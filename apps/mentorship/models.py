"""Mentorship models (Phase 11).

P11-02: MentorRequest を実装。
後続 Issue: MentorProposal (P11-04) / MentorshipContract (P11-05) /
MentorProfile (P11-11) / MentorPlan (P11-12) / MentorReview (P11-20)。

spec: ``docs/specs/phase-11-mentor-board-spec.md`` §4
"""

from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

REQUEST_EXPIRY_DAYS = 30


def _default_expires_at():
    """`MentorRequest.expires_at` のデフォルト値。 作成時の `now() + 30 日`。

    Django migration が lambda を serialize できないので module 関数として
    切り出してある。
    """

    return timezone.now() + timedelta(days=REQUEST_EXPIRY_DAYS)


class MentorRequest(models.Model):
    """mentee が出す「メンターを募集します」 投稿 (P11-02)。

    spec §4.3。 `OPEN` 状態でのみ mentor が proposal を出せ、 mentee が accept すると
    `MATCHED`、 期限切れで `EXPIRED`、 手動 close で `CLOSED`。
    """

    class Status(models.TextChoices):
        OPEN = "open", "募集中"
        MATCHED = "matched", "成立済"
        CLOSED = "closed", "終了"
        EXPIRED = "expired", "期限切れ"

    mentee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="mentor_requests",
    )
    title = models.CharField(max_length=80)
    body = models.TextField(max_length=2000)
    # スキル taxonomy は既存 apps.tags.Tag を流用 (spec §3、 重複 master を作らない)。
    target_skill_tags = models.ManyToManyField(
        "tags.Tag",
        related_name="mentor_requests",
        blank=True,
    )
    # Phase 11 は無償ベータ pivot のため 0 推奨だが、 将来 Stripe 連携時に
    # mentee 側の budget hint として残す placeholder。
    budget_jpy = models.PositiveIntegerField(default=0)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.OPEN,
    )
    # cached counter。 atomic 更新は P11-04 で proposal 投稿時に F() で行う。
    proposal_count = models.PositiveIntegerField(default=0)
    # 30 日 auto-expire のしきい値。 Celery beat (P11-24) で
    # `status=OPEN AND now()>expires_at` を `EXPIRED` に flip する。
    expires_at = models.DateTimeField(default=_default_expires_at)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # 一覧 (status=open、 新着順) を高速化。
            models.Index(fields=["status", "-created_at"]),
            # mentee 視点 (自分の募集一覧) を高速化。
            models.Index(fields=["mentee", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"MentorRequest({self.mentee_id}, {self.title[:30]}, {self.status})"
