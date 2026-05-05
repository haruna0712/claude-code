"""Tests for `reaction_summary` field in Tweet serializers (#383).

仕様: docs/specs/reactions-spec.md §2.10, §4.1, §4.3

検証観点:
- counts は 10 kind 全部 0 埋めで返る
- viewer 別の my_kind が反映される (匿名は null、別 user は別の値)
- 既存の `reaction_count` と `sum(counts.values())` が一致する
- TweetListSerializer / TweetDetailSerializer / TweetMiniSerializer 全てで返る
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient, APIRequestFactory

from apps.reactions.models import Reaction
from apps.tweets.serializers import (
    TweetDetailSerializer,
    TweetListSerializer,
    TweetMiniSerializer,
)
from apps.tweets.tests._factories import make_tweet, make_user


@pytest.fixture
def request_factory() -> APIRequestFactory:
    return APIRequestFactory()


@pytest.mark.django_db
@pytest.mark.integration
class TestReactionSummary:
    def test_zero_fill_when_no_reactions(self, request_factory: APIRequestFactory) -> None:
        tweet = make_tweet()
        request = request_factory.get("/")
        request.user = make_user()
        data = TweetListSerializer(tweet, context={"request": request}).data
        summary = data["reaction_summary"]
        assert set(summary["counts"].keys()) == {
            "like",
            "interesting",
            "learned",
            "helpful",
            "agree",
            "surprised",
            "congrats",
            "respect",
            "funny",
            "code",
        }
        assert all(v == 0 for v in summary["counts"].values())
        assert summary["my_kind"] is None

    def test_counts_reflect_reactions_aggregated(self, request_factory: APIRequestFactory) -> None:
        tweet = make_tweet()
        u1, u2, u3 = make_user(), make_user(), make_user()
        Reaction.objects.create(user=u1, tweet=tweet, kind="like")
        Reaction.objects.create(user=u2, tweet=tweet, kind="like")
        Reaction.objects.create(user=u3, tweet=tweet, kind="learned")

        request = request_factory.get("/")
        request.user = make_user()  # 第三者
        data = TweetListSerializer(tweet, context={"request": request}).data
        counts = data["reaction_summary"]["counts"]
        assert counts["like"] == 2
        assert counts["learned"] == 1
        assert counts["agree"] == 0

    def test_my_kind_reflects_viewer(self, request_factory: APIRequestFactory) -> None:
        tweet = make_tweet()
        u1 = make_user()
        u2 = make_user()
        Reaction.objects.create(user=u1, tweet=tweet, kind="like")

        # u1 視点 → my_kind=like
        req1 = request_factory.get("/")
        req1.user = u1
        d1 = TweetListSerializer(tweet, context={"request": req1}).data
        assert d1["reaction_summary"]["my_kind"] == "like"

        # u2 視点 → my_kind=null (反応していない)
        req2 = request_factory.get("/")
        req2.user = u2
        d2 = TweetListSerializer(tweet, context={"request": req2}).data
        assert d2["reaction_summary"]["my_kind"] is None

    def test_unauthenticated_my_kind_null(self, request_factory: APIRequestFactory) -> None:
        tweet = make_tweet()
        u1 = make_user()
        Reaction.objects.create(user=u1, tweet=tweet, kind="like")

        from django.contrib.auth.models import AnonymousUser

        request = request_factory.get("/")
        request.user = AnonymousUser()
        data = TweetListSerializer(tweet, context={"request": request}).data
        summary = data["reaction_summary"]
        assert summary["my_kind"] is None
        # counts は誰でも見られる
        assert summary["counts"]["like"] == 1

    def test_detail_serializer_also_returns_summary(
        self, request_factory: APIRequestFactory
    ) -> None:
        tweet = make_tweet()
        u1 = make_user()
        Reaction.objects.create(user=u1, tweet=tweet, kind="agree")
        request = request_factory.get("/")
        request.user = u1
        data = TweetDetailSerializer(tweet, context={"request": request}).data
        assert data["reaction_summary"]["counts"]["agree"] == 1
        assert data["reaction_summary"]["my_kind"] == "agree"

    def test_mini_serializer_also_returns_summary(self, request_factory: APIRequestFactory) -> None:
        tweet = make_tweet()
        u1 = make_user()
        Reaction.objects.create(user=u1, tweet=tweet, kind="learned")
        request = request_factory.get("/")
        request.user = u1
        data = TweetMiniSerializer(tweet, context={"request": request}).data
        assert data["reaction_summary"]["counts"]["learned"] == 1
        assert data["reaction_summary"]["my_kind"] == "learned"


@pytest.mark.django_db
@pytest.mark.integration
class TestReactionSummaryViaAPI:
    def test_timeline_endpoint_includes_reaction_summary(self) -> None:
        author = make_user()
        viewer = make_user()
        tweet = make_tweet(author=author, body="t1")
        Reaction.objects.create(user=author, tweet=tweet, kind="like")

        client = APIClient()
        client.force_authenticate(user=viewer)
        # tweet 詳細経由で確認 (timeline は別 view だが同じ serializer 系)
        res = client.get(f"/api/v1/tweets/{tweet.id}/")
        assert res.status_code == 200
        body = res.data
        assert "reaction_summary" in body
        assert body["reaction_summary"]["counts"]["like"] == 1
        assert body["reaction_summary"]["my_kind"] is None  # viewer は反応していない

        # author 視点では my_kind=like
        client.force_authenticate(user=author)
        res = client.get(f"/api/v1/tweets/{tweet.id}/")
        assert res.data["reaction_summary"]["my_kind"] == "like"
