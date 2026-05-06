"""Tests for /api/v1/users/<handle>/likes/ (#421)."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.reactions.models import Reaction, ReactionKind
from apps.tweets.tests._factories import make_tweet, make_user


@pytest.mark.django_db
class TestUserLikesAPI:
    def url(self, handle: str) -> str:
        return reverse("users-likes", kwargs={"handle": handle})

    def test_returns_liked_tweets_in_recency_order(self, api_client: APIClient) -> None:
        author = make_user()
        liker = make_user()
        t1 = make_tweet(author=author, body="oldest")
        t2 = make_tweet(author=author, body="middle")
        t3 = make_tweet(author=author, body="newest")
        # liker が t1 → t2 → t3 の順で like
        Reaction.objects.create(user=liker, tweet=t1, kind=ReactionKind.LIKE)
        Reaction.objects.create(user=liker, tweet=t2, kind=ReactionKind.LIKE)
        Reaction.objects.create(user=liker, tweet=t3, kind=ReactionKind.LIKE)

        res = api_client.get(self.url(liker.username))
        assert res.status_code == status.HTTP_200_OK
        results = res.data["results"]
        # 最後に like した順 (= reaction.created_at 降順)
        bodies = [r["body"] for r in results]
        assert bodies == ["newest", "middle", "oldest"]

    def test_excludes_other_kinds(self, api_client: APIClient) -> None:
        liker = make_user()
        t = make_tweet()
        # LIKE 以外の kind は除外される (例: WOW)
        Reaction.objects.create(user=liker, tweet=t, kind="wow")
        res = api_client.get(self.url(liker.username))
        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_excludes_deleted_tweets(self, api_client: APIClient) -> None:
        author = make_user()
        liker = make_user()
        t = make_tweet(author=author)
        Reaction.objects.create(user=liker, tweet=t, kind=ReactionKind.LIKE)
        t.is_deleted = True
        t.save(update_fields=["is_deleted"])

        res = api_client.get(self.url(liker.username))
        assert res.status_code == status.HTTP_200_OK
        assert res.data["results"] == []

    def test_404_for_inactive_user(self, api_client: APIClient) -> None:
        u = make_user()
        u.is_active = False
        u.save(update_fields=["is_active"])
        res = api_client.get(self.url(u.username))
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_404_for_unknown_handle(self, api_client: APIClient) -> None:
        res = api_client.get(self.url("nonexistent_user"))
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_anonymous_can_view(self, api_client: APIClient) -> None:
        liker = make_user()
        t = make_tweet()
        Reaction.objects.create(user=liker, tweet=t, kind=ReactionKind.LIKE)
        # AllowAny なので未認証でも見れる
        res = api_client.get(self.url(liker.username))
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["results"]) == 1

    def test_other_user_likes_not_mixed(self, api_client: APIClient) -> None:
        u1 = make_user()
        u2 = make_user()
        t1 = make_tweet()
        t2 = make_tweet()
        Reaction.objects.create(user=u1, tweet=t1, kind=ReactionKind.LIKE)
        Reaction.objects.create(user=u2, tweet=t2, kind=ReactionKind.LIKE)

        res = api_client.get(self.url(u1.username))
        assert res.status_code == status.HTTP_200_OK
        # u2 の like は混ざらない
        assert len(res.data["results"]) == 1
        assert res.data["results"][0]["id"] == t1.pk


@pytest.mark.django_db
class TestPublicProfileCounts:
    def url(self, handle: str) -> str:
        return reverse("users-public-profile", kwargs={"username": handle})

    def test_response_includes_followers_and_following_count(self, api_client: APIClient) -> None:
        target = make_user()
        target.followers_count = 5
        target.following_count = 3
        target.save(update_fields=["followers_count", "following_count"])

        res = api_client.get(self.url(target.username))
        assert res.status_code == status.HTTP_200_OK
        assert res.data["followers_count"] == 5
        assert res.data["following_count"] == 3
