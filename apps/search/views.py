"""Search API views (P2-11 / Issue #205).

GET /api/v1/search/?q=...&limit=N

#808 (2026-05-19): permission を IsAuthenticated に変更。 ハルナさん指示で
anon の検索クエリ実行を禁止する (search?q=... での lurker 検索を遮断、
acquisition funnel として 「検索したいなら登録して」 と促す)。 anon は frontend
の SearchExploreSurface 側で 「検索はログインが必要です」 promo を見るだけ。

フィルタ演算子は P2-12 (#206) で拡張。
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.search.services import (
    DEFAULT_LIMIT,
    MAX_LIMIT,
    _normalize_sort,
    search_tweets,
)
from apps.tweets.serializers import TweetListSerializer


class SearchView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        query = (request.query_params.get("q") or "").strip()
        try:
            limit = max(
                1,
                min(int(request.query_params.get("limit", DEFAULT_LIMIT)), MAX_LIMIT),
            )
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT

        # #811: sort=latest|top で検索結果の順序を切替。 不正値は latest にフォールバック。
        sort = _normalize_sort(request.query_params.get("sort"))

        tweets = search_tweets(query, limit=limit, viewer=request.user, sort=sort)
        data = TweetListSerializer(tweets, many=True, context={"request": request}).data
        return Response({"query": query, "sort": sort, "results": data, "count": len(data)})
