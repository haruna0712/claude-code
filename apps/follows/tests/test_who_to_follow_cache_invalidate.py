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
        """build → cache → follow 1 人 → 次の get_who_to_follow が再 build され relaxed fallback が反映される.

        過程:
          1) viewer から見える未フォロー候補 = a, b
          2) get_who_to_follow → cache に [a, b] が入る
          3) viewer が a を follow
          4) signal で WTF cache が invalidate
          5) get_who_to_follow を再呼び出し → 再 build。a は既フォローだが relaxed
             fallback で出る (is_following=True) + b も出る
        """
        viewer = make_user()
        a = make_user()
        b = make_user()

        # 1) 初期 build: a, b 共に未フォローで出る (両方とも is_following=False)
        first = get_who_to_follow(viewer, limit=3)
        first_handles = {r["user"]["handle"] for r in first}
        assert {a.username, b.username}.issubset(first_handles)

        # 2) viewer が a を follow → signal 経由で cache 無効化
        make_follow(viewer, a)

        # 3) 再呼び出し: a は is_following=True、b は False で両方とも出る
        second = get_who_to_follow(viewer, limit=3)
        by_handle = {r["user"]["handle"]: r["user"]["is_following"] for r in second}
        assert by_handle.get(a.username) is True
        assert by_handle.get(b.username) is False
