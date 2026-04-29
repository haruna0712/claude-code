"""Trending tags aggregation (P2-09 / GitHub #184).

Celery Beat で 30 分ごとに過去 24h のタグ使用回数 + reaction_count 重みを集計し
Redis にキャッシュする。`apps.tags.views.TrendingTagsView` が読み出す。
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.core.cache import cache
from django.db.models import Count, F, Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

TRENDING_CACHE_KEY = "trending:tags"
TRENDING_TTL_SECONDS = 35 * 60  # 35 min (Beat は 30 min)
TRENDING_LIMIT = 10
TRENDING_REACTION_WEIGHT = 0.1


@shared_task(name="apps.tags.aggregate_trending_tags")
def aggregate_trending_tags() -> list[dict]:
    """24h 内タグ集計を Redis に書き込む.

    score = tag_uses_24h + reaction_count * 0.1
    NULL 安全 (db M-3): COALESCE で reaction_count=NULL を 0 に補正。
    """
    from apps.tags.models import Tag
    from apps.tweets.models import TweetTag

    cutoff = timezone.now() - timedelta(hours=24)

    rows = (
        TweetTag.objects.filter(tweet__created_at__gte=cutoff, tweet__is_deleted=False)
        .values("tag_id")
        .annotate(
            tag_uses_24h=Count("id"),
            reactions=Sum(F("tweet__reaction_count")),
        )
    )

    scored: list[dict] = []
    for row in rows:
        uses = row["tag_uses_24h"] or 0
        reactions = row["reactions"] or 0
        score = uses + reactions * TRENDING_REACTION_WEIGHT
        scored.append(
            {"tag_id": row["tag_id"], "uses": uses, "reactions": reactions, "score": score}
        )

    scored.sort(key=lambda r: r["score"], reverse=True)
    top = scored[:TRENDING_LIMIT]

    # Tag メタを引いて payload を組む
    tag_ids = [r["tag_id"] for r in top]
    tags = {t.pk: t for t in Tag.objects.filter(pk__in=tag_ids)}
    payload = []
    for rank, r in enumerate(top, start=1):
        tag = tags.get(r["tag_id"])
        if tag is None:
            continue
        payload.append(
            {
                "rank": rank,
                "tag": {
                    "name": tag.name,
                    "display_name": getattr(tag, "display_name", tag.name),
                },
                "uses": r["uses"],
                "score": round(r["score"], 2),
            }
        )

    cache.set(TRENDING_CACHE_KEY, payload, TRENDING_TTL_SECONDS)
    logger.info(
        "trending_tags_aggregated",
        extra={"event": "tags.trending.aggregate", "count": len(payload)},
    )
    return payload
