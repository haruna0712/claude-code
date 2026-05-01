"""Search API views (P2-11 / Issue #205).

GET /api/v1/search/?q=...&limit=N

未ログインでも検索可。フィルタ演算子は P2-12 (#206) で拡張。
"""

from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.search.services import DEFAULT_LIMIT, MAX_LIMIT, search_tweets
from apps.tweets.serializers import TweetListSerializer


class SearchView(APIView):
    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        query = (request.query_params.get("q") or "").strip()
        try:
            limit = max(
                1,
                min(int(request.query_params.get("limit", DEFAULT_LIMIT)), MAX_LIMIT),
            )
        except (TypeError, ValueError):
            limit = DEFAULT_LIMIT

        tweets = search_tweets(query, limit=limit)
        data = TweetListSerializer(tweets, many=True, context={"request": request}).data
        return Response({"query": query, "results": data, "count": len(data)})
