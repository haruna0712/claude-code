"""Follow model unit tests (P2-03 / GitHub #178).

検証観点:
- UniqueConstraint(follower, followee): 重複 INSERT で IntegrityError
- CheckConstraint(no_self_follow): self-follow で IntegrityError (DB 二重防御)
- signals: Follow 作成 / 削除で User.followers_count / following_count が
  ``transaction.on_commit`` 経由で +1 / -1 される。
"""

from __future__ import annotations

import pytest
from django.db import IntegrityError, transaction

from apps.follows.models import Follow
from apps.follows.tests._factories import make_follow, make_user


@pytest.mark.django_db
def test_follow_unique_constraint_blocks_duplicate() -> None:
    a = make_user()
    b = make_user()
    Follow.objects.create(follower=a, followee=b)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Follow.objects.create(follower=a, followee=b)


@pytest.mark.django_db
def test_follow_check_constraint_blocks_self_follow() -> None:
    a = make_user()
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Follow.objects.create(follower=a, followee=a)


@pytest.mark.django_db(transaction=True)
def test_signal_increments_counters_on_create() -> None:
    """post_save → transaction.on_commit でカウンタが +1 される.

    transaction=True を指定して on_commit が実行されるようにする
    (django.test.TestCase 既定の TransactionTestCase 流儀)。
    """
    a = make_user()
    b = make_user()
    assert a.following_count == 0
    assert b.followers_count == 0

    make_follow(a, b)
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.following_count == 1
    assert b.followers_count == 1


@pytest.mark.django_db(transaction=True)
def test_signal_decrements_counters_on_delete() -> None:
    a = make_user()
    b = make_user()
    follow = make_follow(a, b)
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.following_count == 1
    assert b.followers_count == 1

    follow.delete()
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.following_count == 0
    assert b.followers_count == 0


@pytest.mark.django_db(transaction=True)
def test_signal_clamps_counter_at_zero() -> None:
    """db H-1: counter が既に 0 の状態で post_delete が走っても -1 にならない."""
    a = make_user()
    b = make_user()
    f = make_follow(a, b)
    # まず手動でカウンタを 0 に戻し、その状態で delete signal を走らせる
    type(a).objects.filter(pk=a.pk).update(following_count=0)
    type(b).objects.filter(pk=b.pk).update(followers_count=0)

    f.delete()
    a.refresh_from_db()
    b.refresh_from_db()
    assert a.following_count == 0
    assert b.followers_count == 0
