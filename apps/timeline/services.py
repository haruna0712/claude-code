"""TL build service (P2-08 / GitHub #183).

ARCHITECTURE §4.1 + SPEC §5.1:
- フォロー 70% + 全体 30% (reaction_count 上位 24h)
- 同 author の連投は 3 件まで
- 重複除外 (Repost と元ツイートが同一 TL に出現する場合 tie-breaker: 最初に出現した行の created_at を採用)
- 双方向 Block 除外 (sec HIGH)
- cursor pagination 20 件/page
- Redis ZSET (`tl:home:{user_id}`, score=timestamp_int, member=tweet_id) を 10 分 TTL
- Cache stampede 対策: `SET NX EX` ロックで同一 user の build を 1 リクエストに直列化

メトリクス:
- timeline.cache_hit_rate / timeline.build_latency_p95 を Phase 2 完成時に
  CloudWatch カスタムメトリクスへ送出する。本実装ではログのみ。
"""

from __future__ import annotations

import logging
import time
from collections.abc import Iterable
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q
from django.utils import timezone

from apps.tweets.models import Tweet, TweetType

logger = logging.getLogger(__name__)
User = get_user_model()

# Tunables
TL_HOME_TTL_SECONDS = 600  # 10 min
TL_HOME_CACHE_KEY = "tl:home:{user_id}"
TL_HOME_LOCK_KEY = "tl:home:{user_id}:lock"
TL_EXPLORE_CACHE_KEY = "tl:explore"
TL_BUILD_LOCK_TIMEOUT = 30  # 30 sec
TL_RATIO_FOLLOWING = 0.7
TL_RATIO_GLOBAL = 0.3
TL_DEFAULT_PAGE_SIZE = 20
TL_BUFFER_SIZE = 200  # 10 pages worth of cached IDs
TL_MAX_AUTHOR_RUN = 3  # 同著者連投は 3 件まで


def _tweet_score(tweet: Tweet) -> int:
    """ZSET score 用の timestamp (epoch seconds, descending sort 用)."""
    return int(tweet.created_at.timestamp())


def _exclude_blocked_users_qs(user) -> set[int]:
    """sec HIGH: 双方向 Block 関係にある user_id 集合を返す.

    Phase 4B 実装後に Block model が登場すると自動で有効化される。
    """
    from apps.common.blocking import (
        is_blocked_relationship,  # noqa: F401  - 後方互換のための import 確認
    )

    try:
        from django.apps import apps as _apps

        Block = _apps.get_model("moderation", "Block")
    except LookupError:
        return set()

    blocked_ids: set[int] = set()
    for row in Block.objects.filter(Q(blocker=user) | Q(blockee=user)).values(
        "blocker_id", "blockee_id"
    ):
        blocked_ids.add(row["blocker_id"])
        blocked_ids.add(row["blockee_id"])
    blocked_ids.discard(user.pk)
    return blocked_ids


def _enforce_author_run_limit(tweets: Iterable[Tweet], limit: int) -> list[Tweet]:
    """同 author の連続出現を limit 件で打ち切る (run-length 制限)."""
    out: list[Tweet] = []
    run_count = 0
    last_author: int | None = None
    for t in tweets:
        if t.author_id == last_author:
            run_count += 1
        else:
            run_count = 1
            last_author = t.author_id
        if run_count <= limit:
            out.append(t)
    return out


def _dedup_repost_originals(tweets: Iterable[Tweet]) -> list[Tweet]:
    """同一 tweet_id を 1 件に集約する.

    arch H-2 (tie-breaker): 最初に出現した行の created_at を採用 → Repost と元
    ツイートが両方候補にある場合、先に来た方 (大抵は新しい RT) が残る。
    """
    seen: set[int] = set()
    out: list[Tweet] = []
    for t in tweets:
        # Repost で repost_of がある場合、論理 ID は元ツイートの ID にマップする
        # (RT 経由で同じ tweet が見えるケースを 1 件に集約)
        logical_id = t.repost_of_id if t.type == TweetType.REPOST and t.repost_of_id else t.pk
        if logical_id in seen:
            continue
        seen.add(logical_id)
        out.append(t)
    return out


def _query_following(user, blocked_ids: set[int], limit: int) -> list[Tweet]:
    """フォロー候補 (70%): 24h 以内のフォロイーのツイート (original / repost / reply / quote)."""
    cutoff = timezone.now() - timedelta(hours=24)
    qs = (
        Tweet.objects.select_related("author", "repost_of")
        .filter(
            author__follower_set__follower=user,  # フォロイーのツイート
            created_at__gte=cutoff,
        )
        .exclude(author_id__in=blocked_ids)
        .exclude(author=user)  # 自分のツイートは TL に出さない
        .order_by("-created_at")[:limit]
    )
    return list(qs)


def _query_global(blocked_ids: set[int], exclude_author_id: int | None, limit: int) -> list[Tweet]:
    """全体候補 (30%): 24h 以内の reaction 数上位 (original / quote のみ、repost は重複防止のため除外)."""
    cutoff = timezone.now() - timedelta(hours=24)
    qs = Tweet.objects.select_related("author").filter(
        created_at__gte=cutoff,
        type__in=[TweetType.ORIGINAL, TweetType.QUOTE],
        reaction_count__gt=0,
    )
    if blocked_ids:
        qs = qs.exclude(author_id__in=blocked_ids)
    if exclude_author_id is not None:
        qs = qs.exclude(author_id=exclude_author_id)
    return list(qs.order_by("-reaction_count", "-created_at")[:limit])


def _interleave_70_30(following: list[Tweet], global_: list[Tweet]) -> list[Tweet]:
    """70:30 比率で混在させる. 単純な round-robin (7 follow → 3 global → repeat)."""
    out: list[Tweet] = []
    fi = gi = 0
    pattern = [True] * 7 + [False] * 3  # True = following, False = global
    p = 0
    while fi < len(following) or gi < len(global_):
        want_follow = pattern[p % 10]
        if want_follow and fi < len(following):
            out.append(following[fi])
            fi += 1
        elif not want_follow and gi < len(global_):
            out.append(global_[gi])
            gi += 1
        elif fi < len(following):
            out.append(following[fi])
            fi += 1
        elif gi < len(global_):
            out.append(global_[gi])
            gi += 1
        p += 1
    return out


def build_home_tl(user, limit: int = TL_DEFAULT_PAGE_SIZE) -> list[Tweet]:
    """ホーム TL を build する. キャッシュは呼び出し側で管理.

    Returns:
        最大 ``limit * 2`` 程度の Tweet リスト (ペイロードバッファとして使う)。
    """
    start = time.monotonic()
    blocked = _exclude_blocked_users_qs(user)

    follow_n = max(int(TL_BUFFER_SIZE * TL_RATIO_FOLLOWING), limit)
    global_n = max(int(TL_BUFFER_SIZE * TL_RATIO_GLOBAL), limit // 2)

    following = _query_following(user, blocked, follow_n)
    glob = _query_global(blocked, exclude_author_id=user.pk, limit=global_n)

    merged = _interleave_70_30(following, glob)
    deduped = _dedup_repost_originals(merged)
    capped = _enforce_author_run_limit(deduped, TL_MAX_AUTHOR_RUN)

    elapsed_ms = int((time.monotonic() - start) * 1000)
    logger.info(
        "tl_home_built",
        extra={
            "event": "timeline.home.build",
            "user_id": user.pk,
            "result_count": len(capped),
            "latency_ms": elapsed_ms,
        },
    )
    return capped[:TL_BUFFER_SIZE]


def get_or_build_home_tl(user, limit: int = TL_DEFAULT_PAGE_SIZE) -> tuple[list[Tweet], bool]:
    """Redis キャッシュ経由で home TL を取得.

    Returns:
        (tweets, cache_hit) のタプル。``cache_hit=True`` なら DB query を発行していない。
    """
    cache_key = TL_HOME_CACHE_KEY.format(user_id=user.pk)
    cached_ids = cache.get(cache_key)
    if cached_ids is not None:
        # `Tweet.objects.in_bulk` で順序を保ったまま取得
        rows = Tweet.objects.select_related("author").in_bulk(cached_ids)
        tweets = [rows[pk] for pk in cached_ids if pk in rows]
        return tweets[:limit], True

    # Cache stampede 対策 (sec HIGH): SET NX で lock 取得
    lock_key = TL_HOME_LOCK_KEY.format(user_id=user.pk)
    got_lock = cache.add(lock_key, "1", TL_BUILD_LOCK_TIMEOUT)
    try:
        if got_lock:
            tweets = build_home_tl(user, limit=limit)
            cache.set(cache_key, [t.pk for t in tweets], TL_HOME_TTL_SECONDS)
            return tweets[:limit], False
        # Lock を取れなかった: 別リクエストが build 中。短くスリープして再 read。
        time.sleep(0.05)
        cached_ids = cache.get(cache_key)
        if cached_ids:
            rows = Tweet.objects.select_related("author").in_bulk(cached_ids)
            tweets = [rows[pk] for pk in cached_ids if pk in rows]
            return tweets[:limit], True
        # 最悪 fallback: lock 競合中だがビルド完了を待たず DB hit
        return build_home_tl(user, limit=limit)[:limit], False
    finally:
        if got_lock:
            cache.delete(lock_key)


def invalidate_home_tl(user) -> None:
    """user 自身の home TL キャッシュを無効化する (follow / unfollow / 自ツイート時)."""
    cache.delete(TL_HOME_CACHE_KEY.format(user_id=user.pk))


def build_explore_tl(viewer, limit: int = TL_DEFAULT_PAGE_SIZE) -> list[Tweet]:
    """未ログイン用 explore: 24h 内 reaction 数上位.

    sec HIGH: viewer がいる (auth) 場合は **読み出し時に閲覧者の Block で post-filter**。
    キャッシュには無 filter な候補集合を入れる (`tl:explore` 共通)。
    """
    cache_key = TL_EXPLORE_CACHE_KEY
    cached_ids = cache.get(cache_key)
    if cached_ids is not None:
        rows = Tweet.objects.select_related("author").in_bulk(cached_ids)
        tweets = [rows[pk] for pk in cached_ids if pk in rows]
    else:
        cutoff = timezone.now() - timedelta(hours=24)
        qs = (
            Tweet.objects.select_related("author")
            .filter(
                created_at__gte=cutoff,
                type__in=[TweetType.ORIGINAL, TweetType.QUOTE],
                reaction_count__gt=0,
            )
            .order_by("-reaction_count", "-created_at")[:TL_BUFFER_SIZE]
        )
        tweets = list(qs)
        cache.set(cache_key, [t.pk for t in tweets], TL_HOME_TTL_SECONDS)

    if viewer is not None and getattr(viewer, "is_authenticated", False):
        blocked = _exclude_blocked_users_qs(viewer)
        if blocked:
            tweets = [t for t in tweets if t.author_id not in blocked]

    return tweets[:limit]
