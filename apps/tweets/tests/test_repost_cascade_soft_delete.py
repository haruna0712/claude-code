"""Tests for #400 — 単純リポストは元ツイート削除時に cascade で論理削除.

引用 (type=QUOTE) は本文を持つ独立発言なので cascade しないことも併せて検証。
"""

from __future__ import annotations

import pytest

from apps.tweets.models import Tweet, TweetType
from apps.tweets.tests._factories import make_tweet, make_user


@pytest.mark.django_db
@pytest.mark.integration
class TestRepostCascadeSoftDelete:
    def test_simple_repost_is_soft_deleted_when_source_is_deleted(self) -> None:
        author = make_user()
        reposter = make_user()
        source = make_tweet(author=author, body="original content")

        # 単純リポストを作る (body 空、type=REPOST、repost_of=source)
        repost = Tweet.objects.create(
            author=reposter,
            type=TweetType.REPOST,
            body="",
            repost_of=source,
        )
        assert repost.is_deleted is False

        source.soft_delete()

        repost.refresh_from_db()
        assert repost.is_deleted is True
        assert repost.deleted_at is not None

    def test_quote_is_NOT_soft_deleted_when_source_is_deleted(self) -> None:
        """引用 (本文持ち) は cascade しない."""
        author = make_user()
        quoter = make_user()
        source = make_tweet(author=author, body="original")

        quote = Tweet.objects.create(
            author=quoter,
            type=TweetType.QUOTE,
            body="my comment on this",
            quote_of=source,
        )

        source.soft_delete()

        quote.refresh_from_db()
        assert quote.is_deleted is False
        assert quote.deleted_at is None

    def test_multiple_reposts_are_all_cascaded(self) -> None:
        author = make_user()
        source = make_tweet(author=author)

        reposts = [
            Tweet.objects.create(
                author=make_user(),
                type=TweetType.REPOST,
                body="",
                repost_of=source,
            )
            for _ in range(3)
        ]

        source.soft_delete()

        for r in reposts:
            r.refresh_from_db()
            assert r.is_deleted is True

    def test_already_deleted_repost_is_not_re_processed(self) -> None:
        """source 削除前に既に削除されている repost は変更されない (deleted_at が上書きされない)."""
        author = make_user()
        reposter = make_user()
        source = make_tweet(author=author)

        repost = Tweet.objects.create(
            author=reposter,
            type=TweetType.REPOST,
            body="",
            repost_of=source,
        )
        repost.soft_delete()  # 先に削除
        first_deleted_at = repost.deleted_at
        assert first_deleted_at is not None

        # source を削除しても、既に削除済の repost は二重に update されない。
        # `self.reposts` (default manager) は is_deleted=True を除外するため。
        source.soft_delete()

        repost.refresh_from_db()
        # deleted_at が変わっていないことで、二度目の update が走っていない事を確認
        assert repost.deleted_at == first_deleted_at

    def test_reply_is_not_cascaded(self) -> None:
        """reply (type=REPLY) は repost ではないので cascade されない."""
        author = make_user()
        replier = make_user()
        source = make_tweet(author=author)

        reply = Tweet.objects.create(
            author=replier,
            type=TweetType.REPLY,
            body="my reply",
            reply_to=source,
        )

        source.soft_delete()

        reply.refresh_from_db()
        assert reply.is_deleted is False
