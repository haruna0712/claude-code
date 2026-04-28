"""Follow reconciliation tasks (P2-03 / GitHub #178, db H-1).

signals (`apps/follows/signals.py`) は ``transaction.on_commit`` で commit 後に
カウンタを更新するので通常時は drift しないが、deadlock / OOM kill / Celery
再起動などで commit 後の callback が落ちると User.followers_count /
User.following_count が実態とずれる可能性がある。

本タスクは日次 (深夜 02:30 JST) で全ユーザーに対し
``COUNT(*) FROM follow GROUP BY follower_id / followee_id`` を実態と照合し、
drift を補正する。

Celery Beat スケジュールは Phase 2 完成時に
``config/settings/base.py CELERY_BEAT_SCHEDULE`` に追加する (P2-09 で他の
beat タスクと一緒に登録)。
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count

logger = logging.getLogger(__name__)


@shared_task(name="apps.follows.reconcile_follow_counters")
def reconcile_follow_counters() -> dict[str, int]:
    """User.followers_count / following_count を実態と照合・補正する.

    drift = denormalized counter と ``Follow`` テーブルからの実カウントが食い違う行数。
    補正対象が見つかれば ``UPDATE`` で修正する。

    Returns:
        ``{"checked": N, "fixed_followers": A, "fixed_following": B}``
    """
    User = get_user_model()
    fixed_followers = 0
    fixed_following = 0

    # follower_set (= 自分が followee として登場した回数 = followers_count) を集計
    followers_actual = dict(
        User.objects.annotate(c=Count("follower_set")).values_list("pk", "c")
    )
    # following_set (= 自分が follower として登場した回数 = following_count)
    following_actual = dict(
        User.objects.annotate(c=Count("following_set")).values_list("pk", "c")
    )

    with transaction.atomic():
        for user_pk, actual in followers_actual.items():
            updated = User.objects.filter(pk=user_pk).exclude(
                followers_count=actual
            ).update(followers_count=actual)
            fixed_followers += updated
        for user_pk, actual in following_actual.items():
            updated = User.objects.filter(pk=user_pk).exclude(
                following_count=actual
            ).update(following_count=actual)
            fixed_following += updated

    result = {
        "checked": len(followers_actual),
        "fixed_followers": fixed_followers,
        "fixed_following": fixed_following,
    }
    logger.info(
        "follow counters reconciled",
        extra={"event": "follows.reconcile", **result},
    )
    return result
