"""Search services (P2-11 / Issue #205).

MVP: Tweet 本文への単純キーワード検索。

ADR-0002 で pg_bigm + Lindera を仮採用しているので、Postgres 本番では
``body %% query`` (pg_bigm `%>` 演算子) 相当の N-gram マッチが GIN index で
動く。Django ORM レベルでは ``body__icontains`` を使い、postgres 上で
pg_bigm 拡張が `LIKE` 演算子に介入する形で高速化する。

フィルタ演算子 (tag:/from:/since:/until:/type:/has:) は P2-12 (#206) で
拡張する。本サービスはキーワード単独のシンプル検索のみ。
"""

from __future__ import annotations

from apps.tweets.models import Tweet

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def search_tweets(query: str, limit: int = DEFAULT_LIMIT) -> list[Tweet]:
    """Tweet 本文に ``query`` を含むものを新しい順に返す.

    空文字 / 空白のみのクエリは空リストを返す。``limit`` は上限 ``MAX_LIMIT``
    でクランプする。
    """
    cleaned = (query or "").strip()
    if not cleaned:
        return []

    capped = max(1, min(limit, MAX_LIMIT))
    return list(
        Tweet.objects.select_related("author")
        .filter(body__icontains=cleaned)
        .order_by("-created_at", "-id")[:capped]
    )
