"""Recommended users service (P2-10 / GitHub #185).

SPEC §5.3 の Who to follow:
- Step 1: 興味関心タグマッチ (apps.tags の UserInterestTag が Phase 4 以降で実装される
  まで no-op)
- Step 2: リアクション履歴: 自分がリアクションしたツイートの著者でフォロワー多い順
- Step 3: フォロワー数 fallback
- 既フォロー / 自分 / Bot / Block 関係は除外
- 結果は Redis ``who_to_follow:{user_id}`` に TTL 60min でキャッシュ (lazy compute)
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Count, Q
from django.utils import timezone

from apps.common.blocking import is_blocked_relationship  # noqa: F401 - 警告抑止

logger = logging.getLogger(__name__)
User = get_user_model()

CACHE_KEY = "who_to_follow:{user_id}"
TTL_SECONDS = 60 * 60  # 60 min
DEFAULT_LIMIT = 10
RECENT_REACTION_DAYS = 30


def _existing_follow_ids(user) -> set[int]:
    """user が既にフォローしている user_id の集合."""
    from apps.follows.models import Follow

    return set(Follow.objects.filter(follower=user).values_list("followee_id", flat=True))


def _blocked_user_ids(user) -> set[int]:
    """sec HIGH: 双方向 Block 関係の user_id 集合 (Phase 4B 実装後に有効化)."""
    try:
        from django.apps import apps

        Block = apps.get_model("moderation", "Block")
    except LookupError:
        return set()

    out: set[int] = set()
    for row in Block.objects.filter(Q(blocker=user) | Q(blockee=user)).values(
        "blocker_id", "blockee_id"
    ):
        out.add(row["blocker_id"])
        out.add(row["blockee_id"])
    out.discard(user.pk)
    return out


def _candidates_from_reactions(user, exclude_ids: set[int], limit: int) -> list[dict]:
    """Step 2: 自分がリアクションした著者 top reaction-receivers."""
    from apps.reactions.models import Reaction

    cutoff = timezone.now() - timedelta(days=RECENT_REACTION_DAYS)
    candidates = (
        Reaction.objects.filter(user=user, created_at__gte=cutoff)
        .values("tweet__author_id")
        .annotate(c=Count("id"))
        .order_by("-c")
    )
    out: list[dict] = []
    for row in candidates:
        author_id = row["tweet__author_id"]
        if author_id in exclude_ids or author_id is None:
            continue
        out.append({"user_id": author_id, "reason": "recent_reaction"})
        if len(out) >= limit:
            break
    return out


def _candidates_from_followers_count(exclude_ids: set[int], limit: int) -> list[dict]:
    """Step 3: フォロワー数上位の fallback."""
    qs = (
        User.objects.exclude(pk__in=exclude_ids)
        .order_by("-followers_count")
        .values("pk", "followers_count")[:limit]
    )
    return [{"user_id": row["pk"], "reason": "popular"} for row in qs]


def _serialize_users(rows: list[dict]) -> list[dict[str, Any]]:
    """user_id を実 User に解決し API レスポンス形式に整形."""
    user_ids = [r["user_id"] for r in rows]
    users = {u.pk: u for u in User.objects.filter(pk__in=user_ids)}
    out: list[dict[str, Any]] = []
    for r in rows:
        u = users.get(r["user_id"])
        if u is None:
            continue
        out.append(
            {
                "user": {
                    "id": str(u.id),
                    "handle": u.username,
                    "display_name": u.display_name,
                    "avatar_url": u.avatar_url,
                    "bio": u.bio,
                    "followers_count": u.followers_count,
                },
                "reason": r["reason"],
            }
        )
    return out


def compute_who_to_follow(user, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """SPEC §5.3 の優先順 (興味タグ → リアクション → フォロワー数 fallback) で候補を作成.

    興味関心タグ (UserInterestTag) は Phase 4 以降で実装されるまで skip。
    """
    exclude = {user.pk} | _existing_follow_ids(user) | _blocked_user_ids(user)

    candidates: list[dict] = []
    # Step 1 (interest tags): skip until UserInterestTag が実装されたら有効化

    # Step 2: reaction history
    candidates.extend(_candidates_from_reactions(user, exclude, limit))

    # Step 3: fallback
    if len(candidates) < limit:
        already = exclude | {c["user_id"] for c in candidates}
        candidates.extend(_candidates_from_followers_count(already, limit - len(candidates)))

    return _serialize_users(candidates[:limit])


def get_who_to_follow(user, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """Redis キャッシュ経由で候補を取得 (lazy compute, TTL 60min)."""
    cache_key = CACHE_KEY.format(user_id=user.pk)
    cached = cache.get(cache_key)
    if cached is not None:
        return cached[:limit]
    rows = compute_who_to_follow(user, limit=limit)
    cache.set(cache_key, rows, TTL_SECONDS)
    return rows


def get_popular_users(limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """未ログイン用 popular: フォロワー数上位 (reason は付けない)."""
    qs = User.objects.order_by("-followers_count").values(
        "id", "username", "display_name", "avatar_url", "bio", "followers_count"
    )[:limit]
    return [
        {
            "user": {
                "id": str(row["id"]),
                "handle": row["username"],
                "display_name": row["display_name"],
                "avatar_url": row["avatar_url"],
                "bio": row["bio"],
                "followers_count": row["followers_count"],
            },
            "reason": None,
        }
        for row in qs
    ]
