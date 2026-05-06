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
    """Step 3: フォロワー数上位の fallback.

    #394: is_active=False (= 未アクティベ / 凍結等) のユーザーは
    `PublicProfileView` で 404 になるため、推奨に出すと「存在しない人」へ
    の壊れた link になる。ここで除外する。
    """
    qs = (
        User.objects.filter(is_active=True)
        .exclude(pk__in=exclude_ids)
        .order_by("-followers_count")
        .values("pk", "followers_count")[:limit]
    )
    return [{"user_id": row["pk"], "reason": "popular"} for row in qs]


def _serialize_users(rows: list[dict]) -> list[dict[str, Any]]:
    """user_id を実 User に解決し API レスポンス形式に整形.

    #394: 二段防御で is_active=True のみを返す。Step 2 (reaction) で
    取得した user_id は is_active 未チェックなので、最終 serialize 時に
    弾く必要がある。

    #410: #399 の relaxed fallback 撤回に伴い `following_ids` 引数を撤去。
    recommendation には既フォローを含めない方針に揃えたので、`is_following`
    は常に False で返す (型安定のため field 自体は維持)。
    """
    user_ids = [r["user_id"] for r in rows]
    users = {u.pk: u for u in User.objects.filter(pk__in=user_ids, is_active=True)}
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
                    "is_following": False,
                },
                "reason": r["reason"],
            }
        )
    return out


def compute_who_to_follow(user, limit: int = DEFAULT_LIMIT) -> list[dict[str, Any]]:
    """SPEC §5.3 の優先順 (興味タグ → リアクション → フォロワー数 fallback) で候補を作成.

    興味関心タグ (UserInterestTag) は Phase 4 以降で実装されるまで skip。

    #410: #399 で入れた Step 4 (relaxed fallback) は撤回。**既フォロー
    (following) は recommendation に出さない** という X / FB 標準の動線に
    揃える。候補が limit に満たない場合は出る数が少ないままで OK。
    """
    self_id = {user.pk}
    blocked = _blocked_user_ids(user)
    following = _existing_follow_ids(user)
    base_exclude = self_id | blocked | following

    candidates: list[dict] = []
    # Step 1 (interest tags): skip until UserInterestTag が実装されたら有効化

    # Step 2: reaction history (excludes self + blocked + following)
    candidates.extend(_candidates_from_reactions(user, base_exclude, limit))

    # Step 3: popular fallback (excludes self + blocked + following)
    if len(candidates) < limit:
        already = base_exclude | {c["user_id"] for c in candidates}
        candidates.extend(_candidates_from_followers_count(already, limit - len(candidates)))

    # is_following=False に固定 (既フォローは Step 2/3 で除外済)
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


def invalidate_who_to_follow(user) -> None:
    """user 自身の WTF キャッシュを無効化する (#404).

    follow / unfollow 直後に呼ぶことで、次の `/users/recommended/` 呼び出しで
    最新の候補に基づいて再 build される。古い candidates が TTL 60 分残るのを防ぐ。
    """
    cache.delete(CACHE_KEY.format(user_id=user.pk))


def get_popular_users(
    limit: int = DEFAULT_LIMIT,
    exclude_user_id: int | None = None,
    exclude_following_for_user=None,
) -> list[dict[str, Any]]:
    """未ログイン用 popular: フォロワー数上位 (reason は付けない).

    #394: is_active=True のみ。`PublicProfileView` の隠蔽方針に揃える。
    #406: ``exclude_user_id`` が指定されたら除外 (認証済 viewer 用の二重防御)。
    #410: ``exclude_following_for_user`` (User) が指定されたら、その人が既に
    フォローしているユーザも除外する。WhoToFollow は recommended と popular
    両方の経路で「フォロー中」を出さない方針 (#408 の dismiss と整合)。
    """
    qs = User.objects.filter(is_active=True)
    if exclude_user_id is not None:
        qs = qs.exclude(pk=exclude_user_id)
    if exclude_following_for_user is not None:
        following_ids = _existing_follow_ids(exclude_following_for_user)
        if following_ids:
            qs = qs.exclude(pk__in=following_ids)
    qs = qs.order_by("-followers_count").values(
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
                # 未認証なので is_following は常に False (#399 — 型安定のため出す)
                "is_following": False,
            },
            "reason": None,
        }
        for row in qs
    ]
