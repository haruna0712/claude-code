"""#735 Tweet 鍵アカ visibility テスト。

spec: docs/specs/private-account-spec.md §2.4

カバレッジ:
- 匿名 viewer は公開アカ tweet のみ visible_to に出る
- 自分の鍵アカ tweet は visible_to(self) で見える
- approved follower は鍵アカ author の tweet が見える
- 非 follower / pending follower は鍵アカ tweet を見られない
- 鍵アカの tweet を非 follower が GET → 404 隠蔽
"""

from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.follows.models import Follow
from apps.tweets.models import Tweet
from apps.tweets.tests._factories import make_user


@pytest.mark.django_db
class TestVisibleTo:
    def test_anon_sees_only_public_tweets(self):
        public_author = make_user()
        private_author = make_user(is_private=True)
        t_public = Tweet.objects.create(author=public_author, body="hello")
        t_private = Tweet.objects.create(author=private_author, body="secret")
        ids = list(Tweet.objects.all().visible_to(None).values_list("id", flat=True))
        assert t_public.id in ids
        assert t_private.id not in ids

    def test_self_sees_own_private_tweets(self):
        owner = make_user(is_private=True)
        t = Tweet.objects.create(author=owner, body="self private")
        ids = list(Tweet.objects.all().visible_to(owner).values_list("id", flat=True))
        assert t.id in ids

    def test_approved_follower_sees_private_tweets(self):
        owner = make_user(is_private=True)
        u = make_user()
        Follow.objects.create(follower=u, followee=owner, status=Follow.Status.APPROVED)
        t = Tweet.objects.create(author=owner, body="for followers")
        ids = list(Tweet.objects.all().visible_to(u).values_list("id", flat=True))
        assert t.id in ids

    def test_pending_follower_does_not_see_private_tweets(self):
        owner = make_user(is_private=True)
        u = make_user()
        Follow.objects.create(follower=u, followee=owner, status=Follow.Status.PENDING)
        t = Tweet.objects.create(author=owner, body="for followers only")
        ids = list(Tweet.objects.all().visible_to(u).values_list("id", flat=True))
        assert t.id not in ids

    def test_non_follower_does_not_see_private_tweets(self):
        owner = make_user(is_private=True)
        u = make_user()
        t = Tweet.objects.create(author=owner, body="private only")
        ids = list(Tweet.objects.all().visible_to(u).values_list("id", flat=True))
        assert t.id not in ids


@pytest.mark.django_db
class TestRetrieveHiding:
    def test_anon_gets_404_for_private_users_tweet(self):
        owner = make_user(is_private=True)
        t = Tweet.objects.create(author=owner, body="secret")
        c = APIClient()
        resp = c.get(f"/api/v1/tweets/{t.id}/")
        assert resp.status_code == 404

    def test_non_follower_gets_404(self):
        owner = make_user(is_private=True)
        other = make_user()
        t = Tweet.objects.create(author=owner, body="secret")
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f"/api/v1/tweets/{t.id}/")
        assert resp.status_code == 404

    def test_approved_follower_can_see(self):
        owner = make_user(is_private=True)
        u = make_user()
        Follow.objects.create(follower=u, followee=owner, status=Follow.Status.APPROVED)
        t = Tweet.objects.create(author=owner, body="for followers")
        c = APIClient()
        c.force_authenticate(u)
        resp = c.get(f"/api/v1/tweets/{t.id}/")
        assert resp.status_code == 200
        assert resp.data["body"] == "for followers"

    def test_owner_always_sees_own_tweet(self):
        owner = make_user(is_private=True)
        t = Tweet.objects.create(author=owner, body="mine")
        c = APIClient()
        c.force_authenticate(owner)
        resp = c.get(f"/api/v1/tweets/{t.id}/")
        assert resp.status_code == 200
