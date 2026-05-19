"""Search services (P2-11 / Issue #205, P2-12 operators / #206).

Tweet 本文へのキーワード検索 + フィルタ演算子 (tag/from/since/until/type/has)。

ADR-0002 で pg_bigm + Lindera を仮採用しているので、Postgres 本番では
``body__icontains`` の LIKE 演算子に pg_bigm GIN index が介入する形で
高速化される。
"""

from __future__ import annotations

from datetime import datetime, time, timedelta
from typing import Literal

from django.db.models import F, QuerySet
from django.utils import timezone

from apps.search.parser import ParsedQuery, parse_search_query
from apps.tweets.models import Tweet

DEFAULT_LIMIT = 20
MAX_LIMIT = 100

SortOrder = Literal["latest", "top"]
DEFAULT_SORT: SortOrder = "latest"

# #811: 「注目」 tab の engagement 代理 score。 本物の impression_count は
# 未実装のため、 既存 reaction / repost / reply の重み付け合算で代用。
# 重み: repost=3 (拡散行動が最も信号強い) > reaction=2 (好印象) > reply=1 (議論)。
# 将来 impression_count を導入したら別 sort 候補にできる。
POPULARITY_REACTION_WEIGHT = 2
POPULARITY_REPOST_WEIGHT = 3
POPULARITY_REPLY_WEIGHT = 1


def _normalize_sort(value: str | None) -> SortOrder:
    """Query param からの sort 値を正規化。 不正値は default にフォールバック。"""
    if value == "top":
        return "top"
    return "latest"


def _apply_filters(qs: QuerySet[Tweet], parsed: ParsedQuery) -> QuerySet[Tweet]:
    """Apply each operator from ``parsed`` to ``qs``.

    Order of filters: cheap exact matches (type / from) → range (since/until)
    → m2m joins (tag) → string contains (has:code) → exists check (has:image).
    """
    if parsed.type is not None:
        qs = qs.filter(type=parsed.type)

    if parsed.from_handle is not None:
        # 既存実装の handle 列名は ``username`` (Phase 1 の get_user_model 拡張)。
        # 大文字小文字を意識しない比較で UX をブレさせない。
        qs = qs.filter(author__username__iexact=parsed.from_handle)

    tz = timezone.get_current_timezone()
    if parsed.since is not None:
        start = timezone.make_aware(datetime.combine(parsed.since, time.min), tz)
        qs = qs.filter(created_at__gte=start)
    if parsed.until is not None:
        # until は exclusive: ``until:2026-04-23`` は ~ 2026-04-23 23:59:59 を含む。
        end = timezone.make_aware(datetime.combine(parsed.until + timedelta(days=1), time.min), tz)
        qs = qs.filter(created_at__lt=end)

    for tag in parsed.tags:
        qs = qs.filter(tweet_tags__tag__name=tag)

    if "image" in parsed.has:
        qs = qs.filter(images__isnull=False)
    if "code" in parsed.has:
        # Markdown フェンス記法のコードブロック検知。
        qs = qs.filter(body__contains="```")

    if parsed.tags or "image" in parsed.has:
        qs = qs.distinct()

    return qs


def search_tweets(
    query: str,
    limit: int = DEFAULT_LIMIT,
    viewer=None,
    sort: SortOrder = DEFAULT_SORT,
) -> list[Tweet]:
    """Tweet を ``query`` で検索する。

    クエリ文字列は ``parse_search_query`` で operator + keywords に分解し、
    keywords は本文 (body) に対する icontains マッチ、operator は
    ``_apply_filters`` で QuerySet に適用する。空クエリは空リストを返す。

    #811: ``sort`` parameter で結果の順序を切替:
      - ``latest`` (default): ``-created_at, -id`` (X の 「最新」 相当)
      - ``top``: popularity_score (reaction*2 + repost*3 + reply*1) DESC、
        tie-break で ``-created_at`` (X の 「注目」 相当、 engagement 代理)
    本物の impression_count は未実装 (#811 follow-up で別途設計)。
    """
    parsed = parse_search_query(query)
    has_filter = bool(
        parsed.keywords
        or parsed.tags
        or parsed.from_handle
        or parsed.since
        or parsed.until
        or parsed.type
        or parsed.has
    )
    if not has_filter:
        return []

    capped = max(1, min(limit, MAX_LIMIT))
    qs: QuerySet[Tweet] = Tweet.objects.select_related("author").visible_to(viewer)
    qs = _apply_filters(qs, parsed)
    if parsed.keywords:
        qs = qs.filter(body__icontains=parsed.keywords)

    if sort == "top":
        # popularity_score を annotate して降順、 同 score は最新優先。
        qs = qs.annotate(
            popularity_score=(
                F("reaction_count") * POPULARITY_REACTION_WEIGHT
                + F("repost_count") * POPULARITY_REPOST_WEIGHT
                + F("reply_count") * POPULARITY_REPLY_WEIGHT
            )
        ).order_by("-popularity_score", "-created_at", "-id")
    else:
        qs = qs.order_by("-created_at", "-id")

    return list(qs[:capped])
