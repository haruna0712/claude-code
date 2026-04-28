"""Reaction API integration tests (P2-04 / GitHub #179).

検証観点:
- POST 新規 → 201 + reaction_count +1
- POST 同 kind 再押下 → 200 取消 + count -1
- POST 別 kind → 200 changed (UPDATE のみ、count 不変, arch H-1)
- DELETE 明示取消 → 204 + count -1
- 401 / 404 / 400 (無効 kind)
- 集計 GET 200 (auth/anon)
"""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.follows.tests._factories import make_user
from apps.reactions.models import Reaction, ReactionKind
from apps.tweets.models import Tweet
from apps.tweets.tests._factories import make_tweet


def reaction_url(tweet_id: int) -> str:
    return reverse("reactions-toggle", kwargs={"tweet_id": tweet_id})


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestReactionToggle:
    def test_unauthenticated_post_returns_401(self, api_client: APIClient) -> None:
        author = make_user()
        tweet = make_tweet(author=author)
        res = api_client.post(reaction_url(tweet.pk), {"kind": "like"}, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_create_new_reaction_201(self, api_client: APIClient) -> None:
        author = make_user()
        actor = make_user()
        tweet = make_tweet(author=author)
        api_client.force_authenticate(user=actor)

        res = api_client.post(reaction_url(tweet.pk), {"kind": "like"}, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        body = res.json()
        assert body["created"] is True
        assert body["kind"] == "like"
        assert Reaction.objects.filter(user=actor, tweet=tweet, kind="like").count() == 1
        tweet.refresh_from_db()
        assert tweet.reaction_count == 1

    def test_same_kind_repost_toggles_off(self, api_client: APIClient) -> None:
        actor = make_user()
        tweet = make_tweet(author=make_user())
        Reaction.objects.create(user=actor, tweet=tweet, kind=ReactionKind.LIKE)
        Tweet.objects.filter(pk=tweet.pk).update(reaction_count=1)
        api_client.force_authenticate(user=actor)

        res = api_client.post(reaction_url(tweet.pk), {"kind": "like"}, format="json")

        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        assert body["removed"] is True
        assert body["kind"] is None
        assert Reaction.objects.filter(user=actor, tweet=tweet).count() == 0
        tweet.refresh_from_db()
        assert tweet.reaction_count == 0

    def test_different_kind_updates_only(self, api_client: APIClient) -> None:
        """別 kind を選ぶと UPDATE 1 件で済み reaction_count は不変 (arch H-1)."""
        actor = make_user()
        tweet = make_tweet(author=make_user())
        Reaction.objects.create(user=actor, tweet=tweet, kind=ReactionKind.LIKE)
        Tweet.objects.filter(pk=tweet.pk).update(reaction_count=1)
        api_client.force_authenticate(user=actor)

        res = api_client.post(reaction_url(tweet.pk), {"kind": "learned"}, format="json")

        assert res.status_code == status.HTTP_200_OK
        body = res.json()
        assert body["changed"] is True
        assert body["kind"] == "learned"
        # 行は 1 件のまま、kind だけ更新されている
        existing = Reaction.objects.get(user=actor, tweet=tweet)
        assert existing.kind == ReactionKind.LEARNED
        tweet.refresh_from_db()
        assert tweet.reaction_count == 1

    def test_invalid_kind_returns_400(self, api_client: APIClient) -> None:
        actor = make_user()
        tweet = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)
        res = api_client.post(reaction_url(tweet.pk), {"kind": "bad_kind"}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_delete_204(self, api_client: APIClient) -> None:
        actor = make_user()
        tweet = make_tweet(author=make_user())
        Reaction.objects.create(user=actor, tweet=tweet, kind=ReactionKind.LIKE)
        Tweet.objects.filter(pk=tweet.pk).update(reaction_count=1)
        api_client.force_authenticate(user=actor)

        res = api_client.delete(reaction_url(tweet.pk))

        assert res.status_code == status.HTTP_204_NO_CONTENT
        tweet.refresh_from_db()
        assert tweet.reaction_count == 0

    def test_delete_when_no_reaction_returns_404(self, api_client: APIClient) -> None:
        actor = make_user()
        tweet = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)
        res = api_client.delete(reaction_url(tweet.pk))
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_get_aggregate_includes_all_kinds_zero(self, api_client: APIClient) -> None:
        tweet = make_tweet(author=make_user())
        # 1 件だけ like を作成
        Reaction.objects.create(user=make_user(), tweet=tweet, kind=ReactionKind.LIKE)

        res = api_client.get(reaction_url(tweet.pk))
        assert res.status_code == status.HTTP_200_OK
        counts = res.json()["counts"]
        assert counts["like"] == 1
        # 残り 9 種は 0 で埋められる
        for k in ReactionKind:
            if k.value == "like":
                continue
            assert counts[k.value] == 0
