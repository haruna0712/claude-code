"""Search services (P2-11 / Issue #205, P2-12 operators / #206).

Tweet 本文へのキーワード検索 + フィルタ演算子 (tag/from/since/until/type/has)。

ADR-0002 で pg_bigm + Lindera を仮採用しているので、Postgres 本番では
``body__icontains`` の LIKE 演算子に pg_bigm GIN index が介入する形で
高速化される。
"""

from __future__ import annotations

from datetime import datetime, time, timedelta

from django.db.models import QuerySet
from django.utils import timezone

from apps.search.parser import ParsedQuery, parse_search_query
from apps.tweets.models import Tweet

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


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


def search_tweets(query: str, limit: int = DEFAULT_LIMIT) -> list[Tweet]:
    """Tweet を ``query`` で検索する。

    クエリ文字列は ``parse_search_query`` で operator + keywords に分解し、
    keywords は本文 (body) に対する icontains マッチ、operator は
    ``_apply_filters`` で QuerySet に適用する。空クエリは空リストを返す。
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
    qs: QuerySet[Tweet] = Tweet.objects.select_related("author")
    qs = _apply_filters(qs, parsed)
    if parsed.keywords:
        qs = qs.filter(body__icontains=parsed.keywords)

    return list(qs.order_by("-created_at", "-id")[:capped])
