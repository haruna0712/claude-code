"""Follow model (P2-03 / GitHub #178).

ER §2.4 + SPEC §18.1:
- (follower, followee) はユニーク (重複フォロー防止)
- self-follow を CheckConstraint で DB 層からも reject (二重防御)
- カウンタは User.followers_count / User.following_count を signals で
  ``transaction.on_commit`` 経由で更新する (ロールバック時の drift 防止)
- 双方向 Block 関係チェックは ``apps.common.blocking.is_blocked_relationship``
  を view 層で利用 (Phase 4B 実装後に自動有効化)
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Follow(models.Model):
    """ユーザー間のフォロー関係 1 件を表す。

    フォロー方向は ``follower → followee`` (follower が followee を follow している)。
    削除時は signals で User.followers_count / following_count を ``F-1`` でデクリメント。
    """

    follower = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="following_set",
        help_text="The user performing the follow action.",
    )
    followee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="follower_set",
        help_text="The user being followed.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["follower", "followee"],
                name="unique_follow",
            ),
            # db レベルで self-follow を禁止 (二重防御)。Serializer 層でも 400 を返すが、
            # raw SQL 経由で挿入された場合に備えて DB CheckConstraint を併設する。
            models.CheckConstraint(
                check=~Q(follower=F("followee")),
                name="no_self_follow",
            ),
        ]
        indexes = [
            # フォロワー一覧 / フォロー中一覧の cursor pagination 用 (created_at desc)
            models.Index(fields=["follower", "-created_at"], name="follow_by_follower_idx"),
            models.Index(fields=["followee", "-created_at"], name="follow_by_followee_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"Follow(follower={self.follower_id}, followee={self.followee_id})"
