"""Reaction reconciliation tasks (P2-04 / GitHub #179, db H-1).

signals が ``transaction.on_commit`` で更新するため通常 drift しないが、
ワーカー強制終了時の補正用に日次 Beat。
"""

from __future__ import annotations

import logging

from celery import shared_task
from django.db import transaction
from django.db.models import Count

logger = logging.getLogger(__name__)


@shared_task(name="apps.reactions.reconcile_reaction_counters")
def reconcile_reaction_counters() -> dict[str, int]:
    """Tweet.reaction_count を実態と照合・補正する."""
    from apps.tweets.models import Tweet

    actual = dict(Tweet.all_objects.annotate(c=Count("reactions")).values_list("pk", "c"))
    fixed = 0
    with transaction.atomic():
        for pk, c in actual.items():
            updated = (
                Tweet.all_objects.filter(pk=pk).exclude(reaction_count=c).update(reaction_count=c)
            )
            fixed += updated
    result = {"checked": len(actual), "fixed": fixed}
    logger.info("reaction counters reconciled", extra={"event": "reactions.reconcile", **result})
    return result
