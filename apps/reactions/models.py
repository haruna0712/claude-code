"""Reaction model (P2-04 / GitHub #179).

SPEC §6 + ER §2.9:
- 10 種固定絵文字 (`like / interesting / learned / helpful / agree / surprised /
  congrats / respect / funny / code`)
- 1 user × 1 tweet には 1 種類のみ → ``UniqueConstraint(user, tweet)``
  (kind は constraint に含めない: 種別変更を UPDATE 1 件で表現するため)
- カウンタ更新は ``Tweet.reaction_count`` を signals で transaction.on_commit 経由
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class ReactionKind(models.TextChoices):
    """SPEC §6.2 の 10 種固定絵文字。"""

    LIKE = "like", _("いいね")
    INTERESTING = "interesting", _("面白い")
    LEARNED = "learned", _("勉強になった")
    HELPFUL = "helpful", _("助かった")
    AGREE = "agree", _("わかる")
    SURPRISED = "surprised", _("びっくり")
    CONGRATS = "congrats", _("おめでとう")
    RESPECT = "respect", _("リスペクト")
    FUNNY = "funny", _("笑った")
    CODE = "code", _("コードよき")


class Reaction(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reactions",
    )
    tweet = models.ForeignKey(
        "tweets.Tweet",
        on_delete=models.CASCADE,
        related_name="reactions",
    )
    kind = models.CharField(
        max_length=20,
        choices=ReactionKind.choices,
        help_text="SPEC §6.2 の 10 種から選択。",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            # 1 user × 1 tweet には 1 種類のみ
            models.UniqueConstraint(
                fields=["user", "tweet"],
                name="unique_user_tweet_reaction",
            ),
        ]
        indexes = [
            # 種別ごとの集計 (P2-09 トレンドタグ重み付け で利用)
            models.Index(fields=["tweet", "kind"], name="reaction_tweet_kind_idx"),
            # 自分のリアクション履歴 (おすすめユーザー P2-10 で利用)
            models.Index(fields=["user", "-created_at"], name="reaction_user_idx"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"Reaction(user={self.user_id}, tweet={self.tweet_id}, kind={self.kind})"
