"""Tweet 関連 Celery タスク (P2-07 / GitHub #182).

タスク:
- ``fetch_ogp_for_tweet(tweet_id)``: Tweet 作成時に enqueue。本文最初の URL の
  OGP を取得し、``OgpCache`` に upsert する。Redis を 24h キャッシュとして利用。
- ``purge_stale_ogp()``: 日次 Beat (深夜 04:00 JST) で `last_used_at < now - 7d`
  の OgpCache を物理削除 (db M-1: 孤立蓄積対策).
"""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.tweets.ogp import (
    extract_first_url,
    fetch_ogp,
    normalize_url,
    url_hash,
)

logger = logging.getLogger(__name__)

OGP_CACHE_TTL_SECONDS = 24 * 60 * 60  # 24h
OGP_PURGE_THRESHOLD_DAYS = 7


def _ogp_user_agent() -> str:
    """settings 経由で UA を差し替え可能にする (security review fix)."""
    return getattr(settings, "OGP_USER_AGENT", "SNS-OGP-Bot/1.0")


@shared_task(name="apps.tweets.fetch_ogp_for_tweet")
def fetch_ogp_for_tweet(tweet_id: int) -> dict[str, str] | None:
    """Tweet 本文の最初の URL を fetch し、OgpCache に upsert する.

    呼び出しタイミング: Tweet 作成時 (create / quote / reply view 内で
    ``transaction.on_commit(lambda: fetch_ogp_for_tweet.delay(tweet.id))``)。

    Returns:
        upsert された OgpCache の dict 表現、URL なし / 失敗時は None。
    """
    from apps.tweets.models import OgpCache, Tweet

    try:
        tweet = Tweet.all_objects.get(pk=tweet_id)
    except Tweet.DoesNotExist:
        logger.warning("ogp_fetch_skip_missing_tweet", extra={"tweet_id": tweet_id})
        return None

    raw_url = extract_first_url(tweet.body)
    if raw_url is None:
        return None
    norm = normalize_url(raw_url)
    h = url_hash(norm)

    cache_key = f"ogp:{h}"
    cached = cache.get(cache_key)
    now = timezone.now()

    if cached is not None:
        # Redis hit: 既存 OgpCache の last_used_at を touch (Beat purge 対象から外す)
        OgpCache.objects.filter(url_hash=h).update(last_used_at=now)
        return cached

    # DB hit (Redis miss): 24h 以内のキャッシュなら HTTP fetch せず使い回す
    existing = OgpCache.objects.filter(url_hash=h).first()
    if existing is not None and existing.fetched_at >= now - timedelta(seconds=OGP_CACHE_TTL_SECONDS):
        OgpCache.objects.filter(pk=existing.pk).update(last_used_at=now)
        payload = {
            "url": existing.url,
            "title": existing.title,
            "description": existing.description,
            "image_url": existing.image_url,
            "site_name": existing.site_name,
        }
        cache.set(cache_key, payload, OGP_CACHE_TTL_SECONDS)
        return payload

    # Miss: HTTP fetch (SSRF guarded)
    fetched = fetch_ogp(norm, user_agent=_ogp_user_agent())
    if fetched is None:
        # 失敗時も空 cache を作って再 fetch を抑制 (sec design)
        fetched = {
            "url": norm,
            "title": "",
            "description": "",
            "image_url": "",
            "site_name": "",
        }

    obj, _ = OgpCache.objects.update_or_create(
        url_hash=h,
        defaults={
            "url": fetched["url"][:500],
            "title": fetched.get("title", "")[:300],
            "description": fetched.get("description", "")[:1000],
            "image_url": fetched.get("image_url", "")[:500],
            "site_name": fetched.get("site_name", "")[:200],
            "last_used_at": now,
        },
    )
    payload = {
        "url": obj.url,
        "title": obj.title,
        "description": obj.description,
        "image_url": obj.image_url,
        "site_name": obj.site_name,
    }
    cache.set(cache_key, payload, OGP_CACHE_TTL_SECONDS)
    return payload


@shared_task(name="apps.tweets.purge_stale_ogp")
def purge_stale_ogp() -> dict[str, int]:
    """`last_used_at < now - 7d` の OgpCache を物理削除する (db M-1)."""
    from apps.tweets.models import OgpCache

    threshold = timezone.now() - timedelta(days=OGP_PURGE_THRESHOLD_DAYS)
    deleted, _ = OgpCache.objects.filter(last_used_at__lt=threshold).delete()
    logger.info(
        "ogp_purge_stale", extra={"event": "ogp.purge", "deleted": deleted}
    )
    return {"deleted": deleted}
