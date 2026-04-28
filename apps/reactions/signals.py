"""Reaction signals (P2-04 / GitHub #179).

db H-1 / arch H-1:
- ``post_save`` は **新規作成時のみ** ``Tweet.reaction_count`` を +1。
- 既存 Reaction の kind を UPDATE しただけのときは count を触らない
  (種別変更で 0 → 0 が正しい挙動)。
- ``post_delete`` で count を -1 (Greatest 0 でクリップ)。
- すべて ``transaction.on_commit`` 経由でコミット後に発行 → ロールバック時の
  drift を防ぐ。

reconciliation Beat (`apps.reactions.tasks.reconcile_reaction_counters`) が
日次で drift を補正する。
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.blocking import safe_notify
from apps.reactions.models import Reaction


@receiver(post_save, sender=Reaction)
def on_reaction_saved(
    sender: type[Reaction], instance: Reaction, created: bool, **kwargs: Any
) -> None:
    """新規作成時のみ Tweet.reaction_count を +1。

    arch H-1: 種別変更 (kind UPDATE) では count を変えない (Reaction.save() の
    update_fields に "kind" が含まれていれば signal でも何もしない)。
    """
    if not created:
        # kind 変更 (種別 UPDATE) のケース → count 不変
        return

    tweet_pk = instance.tweet_id
    actor = instance.user
    tweet_author = instance.tweet.author if instance.tweet_id else None

    def _bump() -> None:
        from apps.tweets.models import Tweet

        Tweet.objects.filter(pk=tweet_pk).update(
            reaction_count=F("reaction_count") + 1
        )
        # Phase 4A 実装後に自動有効化
        safe_notify(kind="LIKE", recipient=tweet_author, actor=actor)

    transaction.on_commit(_bump)


@receiver(post_delete, sender=Reaction)
def on_reaction_deleted(
    sender: type[Reaction], instance: Reaction, **kwargs: Any
) -> None:
    """Reaction 削除時に Tweet.reaction_count を -1 (0 でクリップ)."""
    tweet_pk = instance.tweet_id

    def _bump() -> None:
        from apps.tweets.models import Tweet

        Tweet.objects.filter(pk=tweet_pk).update(
            reaction_count=Greatest(F("reaction_count") - 1, 0)
        )

    transaction.on_commit(_bump)
