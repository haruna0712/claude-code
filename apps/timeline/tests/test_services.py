"""TL service unit tests (P2-08 / GitHub #183)."""

from __future__ import annotations

import pytest

from apps.follows.tests._factories import make_follow, make_user
from apps.timeline.services import (
    _dedup_repost_originals,
    _enforce_author_run_limit,
    _interleave_70_30,
    build_explore_tl,
    build_home_tl,
)
from apps.tweets.models import Tweet, TweetType
from apps.tweets.tests._factories import make_tweet


def test_interleave_70_30_pattern() -> None:
    """7 follow → 3 global の pattern が繰り返される."""
    f = [f"f{i}" for i in range(20)]  # type: ignore[var-annotated]
    g = [f"g{i}" for i in range(20)]  # type: ignore[var-annotated]
    out = _interleave_70_30(f, g)  # type: ignore[arg-type]
    # 最初の 10 件は 7:3 のパターン
    assert out[:10] == ["f0", "f1", "f2", "f3", "f4", "f5", "f6", "g0", "g1", "g2"]


def test_enforce_author_run_limit_caps_at_3() -> None:
    """同 author の連投 5 件 → 3 件で打ち切り."""

    class FakeT:
        def __init__(self, author_id: int) -> None:
            self.author_id = author_id

    seq = [FakeT(1), FakeT(1), FakeT(1), FakeT(1), FakeT(1), FakeT(2), FakeT(2)]
    out = _enforce_author_run_limit(seq, 3)
    # author=1 は 3 件まで、author=2 は 2 件
    assert sum(1 for t in out if t.author_id == 1) == 3
    assert sum(1 for t in out if t.author_id == 2) == 2


@pytest.mark.django_db(transaction=True)
def test_dedup_repost_originals_collapses_to_one_logical_id() -> None:
    """RT と元ツイートが同 TL に並ぶと 1 件に集約される (arch H-2 tie-breaker)."""
    author_a = make_user()
    author_b = make_user()
    original = make_tweet(author=author_a, body="orig")
    repost = Tweet.objects.create(
        author=author_b, body="", type=TweetType.REPOST, repost_of=original
    )
    # repost を先に置くと、それが「先勝ち」で残り、original は drop される
    out = _dedup_repost_originals([repost, original])
    assert len(out) == 1
    assert out[0].pk == repost.pk


@pytest.mark.django_db(transaction=True)
def test_build_home_tl_returns_following_tweets() -> None:
    actor = make_user()
    target = make_user()
    make_follow(actor, target)

    # フォロイーがツイート
    t1 = make_tweet(author=target, body="hello1")
    t2 = make_tweet(author=target, body="hello2")
    # 自分のツイートは TL に出ない
    make_tweet(author=actor, body="my own tweet")

    result = build_home_tl(actor, limit=20)
    pks = {t.pk for t in result}
    assert t1.pk in pks
    assert t2.pk in pks
    # 自分のツイートが出ないこと
    assert all(t.author_id != actor.pk for t in result)


@pytest.mark.django_db(transaction=True)
def test_build_explore_tl_returns_only_with_reactions() -> None:
    """explore は reaction_count > 0 のツイートのみ."""
    a = make_user()
    b = make_user()
    no_reaction = make_tweet(author=a, body="no reactions")
    with_reaction = make_tweet(author=b, body="popular")
    Tweet.objects.filter(pk=with_reaction.pk).update(reaction_count=5)

    result = build_explore_tl(viewer=None, limit=20)
    pks = {t.pk for t in result}
    assert with_reaction.pk in pks
    assert no_reaction.pk not in pks
