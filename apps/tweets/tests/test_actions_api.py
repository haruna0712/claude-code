"""Tweet sub-action API tests: repost / quote / reply (P2-06 / GitHub #181)."""

from __future__ import annotations

import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from apps.follows.tests._factories import make_user
from apps.tweets.models import Tweet, TweetType
from apps.tweets.tests._factories import make_tag, make_tweet


def repost_url(tweet_id: int) -> str:
    return reverse("tweets-repost", kwargs={"tweet_id": tweet_id})


def quote_url(tweet_id: int) -> str:
    return reverse("tweets-quote", kwargs={"tweet_id": tweet_id})


def reply_url(tweet_id: int) -> str:
    return reverse("tweets-reply", kwargs={"tweet_id": tweet_id})


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestRepost:
    def test_repost_creates_201(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user(), body="orig")
        api_client.force_authenticate(user=actor)

        res = api_client.post(repost_url(target.pk))

        assert res.status_code == status.HTTP_201_CREATED
        assert res.json()["created"] is True
        assert (
            Tweet.objects.filter(author=actor, type=TweetType.REPOST, repost_of=target).count() == 1
        )
        target.refresh_from_db()
        assert target.repost_count == 1

    def test_repost_idempotent_200(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user())
        Tweet.objects.create(author=actor, body="", type=TweetType.REPOST, repost_of=target)
        api_client.force_authenticate(user=actor)

        res = api_client.post(repost_url(target.pk))

        assert res.status_code == status.HTTP_200_OK
        assert res.json()["created"] is False
        assert (
            Tweet.objects.filter(author=actor, type=TweetType.REPOST, repost_of=target).count() == 1
        )

    def test_repost_unauthenticated_401(self, api_client: APIClient) -> None:
        target = make_tweet(author=make_user())
        res = api_client.post(repost_url(target.pk))
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_repost_unknown_tweet_404(self, api_client: APIClient) -> None:
        actor = make_user()
        api_client.force_authenticate(user=actor)
        res = api_client.post(repost_url(999_999))
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_repost_delete_204(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user())
        Tweet.objects.create(author=actor, body="", type=TweetType.REPOST, repost_of=target)
        api_client.force_authenticate(user=actor)

        res = api_client.delete(repost_url(target.pk))

        assert res.status_code == status.HTTP_204_NO_CONTENT
        target.refresh_from_db()
        assert target.repost_count == 0

    def test_repost_delete_when_not_reposted_404(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)
        res = api_client.delete(repost_url(target.pk))
        assert res.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestQuoteAndReply:
    def test_quote_creates_with_body_201(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)
        tag = make_tag(name="python", is_approved=True)

        res = api_client.post(
            quote_url(target.pk),
            {"body": "面白いツイート", "tags": [tag.name]},
            format="json",
        )

        assert res.status_code == status.HTTP_201_CREATED
        body = res.json()
        assert body["body"] == "面白いツイート"
        target.refresh_from_db()
        assert target.quote_count == 1

        quote = Tweet.objects.get(pk=body["id"])
        assert quote.type == TweetType.QUOTE
        assert quote.quote_of_id == target.pk

    def test_reply_creates_201(self, api_client: APIClient) -> None:
        actor = make_user()
        parent = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)

        res = api_client.post(
            reply_url(parent.pk),
            {"body": "なるほど"},
            format="json",
        )

        assert res.status_code == status.HTTP_201_CREATED
        parent.refresh_from_db()
        assert parent.reply_count == 1
        reply = Tweet.objects.get(pk=res.json()["id"])
        assert reply.type == TweetType.REPLY
        assert reply.reply_to_id == parent.pk

    def test_quote_unauthenticated_401(self, api_client: APIClient) -> None:
        target = make_tweet(author=make_user())
        res = api_client.post(quote_url(target.pk), {"body": "x"}, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_quote_empty_body_400(self, api_client: APIClient) -> None:
        actor = make_user()
        target = make_tweet(author=make_user())
        api_client.force_authenticate(user=actor)
        # body 必須 (TweetCreateSerializer のバリデーション)
        res = api_client.post(quote_url(target.pk), {"body": ""}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestResolveTargetRepostFallthrough:
    """#346: REPOST tweet を target に渡されたら repost_of に解決する."""

    def test_repost_of_repost_falls_through_to_original(self, api_client: APIClient) -> None:
        """A→B→C を順に追って、C が B (REPOST tweet) を repost しても A の REPOST が作られる."""
        author_a = make_user()
        original = make_tweet(author=author_a, body="original")
        actor_b = make_user()
        repost_b = Tweet.objects.create(
            author=actor_b, body="", type=TweetType.REPOST, repost_of=original
        )
        actor_c = make_user()
        api_client.force_authenticate(user=actor_c)

        # C が B の REPOST 行 (= repost_b) を target に repost を投げる
        res = api_client.post(repost_url(repost_b.pk))

        assert res.status_code == status.HTTP_201_CREATED
        c_repost = Tweet.objects.get(author=actor_c, type=TweetType.REPOST)
        # C の REPOST は B ではなく A の original を指す (RT のチェーンを許さない)
        assert c_repost.repost_of_id == original.pk
        assert c_repost.repost_of_id != repost_b.pk

    def test_quote_of_repost_falls_through_to_original(self, api_client: APIClient) -> None:
        author_a = make_user()
        original = make_tweet(author=author_a, body="original")
        actor_b = make_user()
        repost_b = Tweet.objects.create(
            author=actor_b, body="", type=TweetType.REPOST, repost_of=original
        )
        actor_c = make_user()
        api_client.force_authenticate(user=actor_c)

        res = api_client.post(quote_url(repost_b.pk), {"body": "コメント"}, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        quote = Tweet.objects.get(pk=res.json()["id"])
        assert quote.quote_of_id == original.pk

    def test_repost_target_is_repost_with_deleted_original_404(self, api_client: APIClient) -> None:
        """REPOST tweet を target に渡したが元 tweet が削除済みなら 404."""
        author_a = make_user()
        original = make_tweet(author=author_a)
        actor_b = make_user()
        repost_b = Tweet.objects.create(
            author=actor_b, body="", type=TweetType.REPOST, repost_of=original
        )
        # 元 tweet を soft-delete (alive Manager から外す)
        original.soft_delete()
        actor_c = make_user()
        api_client.force_authenticate(user=actor_c)

        res = api_client.post(repost_url(repost_b.pk))

        assert res.status_code == status.HTTP_404_NOT_FOUND
