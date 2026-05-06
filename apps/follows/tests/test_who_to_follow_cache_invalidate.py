"""Tests for #404 — WTF Redis cache invalidation on follow/unfollow."""

from __future__ import annotations

import pytest
from django.core.cache import cache

from apps.follows.services import CACHE_KEY, get_who_to_follow, invalidate_who_to_follow
from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestInvalidateWhoToFollow:
    def test_invalidate_deletes_cache_entry(self) -> None:
        viewer = make_user()
        cache.set(CACHE_KEY.format(user_id=viewer.pk), [{"stale": True}], 3600)
        assert cache.get(CACHE_KEY.format(user_id=viewer.pk)) is not None

        invalidate_who_to_follow(viewer)

        assert cache.get(CACHE_KEY.format(user_id=viewer.pk)) is None


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestFollowSignalsInvalidateWtfCache:
    def test_follow_creation_invalidates_followers_wtf_cache(self) -> None:
        """follow が作られると follower の WTF cache が消える."""
        follower = make_user()
        followee = make_user()
        # 旧 cache を仕込む
        cache.set(CACHE_KEY.format(user_id=follower.pk), [{"stale": True}], 3600)

        make_follow(follower, followee)

        assert cache.get(CACHE_KEY.format(user_id=follower.pk)) is None

    def test_follow_creation_invalidates_followee_wtf_cache(self) -> None:
        """followee 側の WTF cache も無効化 (relaxed fallback で見え方が変わるため)."""
        follower = make_user()
        followee = make_user()
        cache.set(CACHE_KEY.format(user_id=followee.pk), [{"stale": True}], 3600)

        make_follow(follower, followee)

        assert cache.get(CACHE_KEY.format(user_id=followee.pk)) is None

    def test_unfollow_invalidates_both_caches(self) -> None:
        follower = make_user()
        followee = make_user()
        f = make_follow(follower, followee)
        cache.set(CACHE_KEY.format(user_id=follower.pk), [{"stale": True}], 3600)
        cache.set(CACHE_KEY.format(user_id=followee.pk), [{"stale": True}], 3600)

        f.delete()

        assert cache.get(CACHE_KEY.format(user_id=follower.pk)) is None
        assert cache.get(CACHE_KEY.format(user_id=followee.pk)) is None


@pytest.mark.django_db(transaction=True)
@pytest.mark.integration
class TestEndToEndCacheRefreshAfterFollow:
    def test_recommendations_reflect_new_follow_after_signal(self) -> None:
        """build → cache → follow 1 人 → cache invalidate → 既フォローは消える (#410).

        過程:
          1) viewer から見える未フォロー候補 = a, b 両方出る
          2) viewer が a を follow → signal で WTF cache が invalidate
          3) 再呼び出し → a は除外、b のみ残る (relaxed fallback は撤回済 #410)
        """
        viewer = make_user()
        a = make_user()
        b = make_user()

        # 1) 初期 build: a, b 共に未フォローで出る
        first = get_who_to_follow(viewer, limit=3)
        first_handles = {r["user"]["handle"] for r in first}
        assert {a.username, b.username}.issubset(first_handles)

        # 2) viewer が a を follow → signal 経由で cache 無効化
        make_follow(viewer, a)

        # 3) 再呼び出し: a は既フォローなので除外、b だけ残る
        second = get_who_to_follow(viewer, limit=3)
        handles = {r["user"]["handle"] for r in second}
        assert a.username not in handles
        assert b.username in handles
        # is_following は常に False (#410: relaxed fallback 撤回後)
        assert all(r["user"]["is_following"] is False for r in second)
