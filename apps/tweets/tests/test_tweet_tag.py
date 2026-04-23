"""TweetTag のテスト (P1-07)。

- 3 個まで OK、4 個目は clean() で ValidationError
- (tweet, tag) のユニーク制約
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.tweets.models import TWEET_MAX_TAGS, TweetTag
from apps.tweets.tests._factories import make_tag, make_tweet


class TweetTagLimitTests(TestCase):
    """1 ツイートあたりのタグ数上限 (3)。"""

    def test_up_to_three_tags_allowed(self) -> None:
        tweet = make_tweet()
        for i in range(TWEET_MAX_TAGS):
            tag = make_tag(name=f"tag{i}")
            TweetTag.objects.create(tweet=tweet, tag=tag)

        self.assertEqual(tweet.tags.count(), TWEET_MAX_TAGS)

    def test_fourth_tag_raises_validation_error(self) -> None:
        tweet = make_tweet()
        for i in range(TWEET_MAX_TAGS):
            tag = make_tag(name=f"tag{i}")
            TweetTag.objects.create(tweet=tweet, tag=tag)

        fourth_tag = make_tag(name="tag-extra")
        fourth = TweetTag(tweet=tweet, tag=fourth_tag)

        with self.assertRaises(ValidationError):
            fourth.full_clean()


class TweetTagUniqueTests(TestCase):
    """(tweet, tag) のユニーク制約。"""

    def test_same_tag_cannot_be_attached_twice(self) -> None:
        tweet = make_tweet()
        tag = make_tag(name="python")
        TweetTag.objects.create(tweet=tweet, tag=tag)

        with self.assertRaises(IntegrityError), transaction.atomic():
            TweetTag.objects.create(tweet=tweet, tag=tag)

    def test_same_tag_allowed_on_different_tweets(self) -> None:
        tag = make_tag(name="python")
        t1 = make_tweet()
        t2 = make_tweet(author=t1.author)

        TweetTag.objects.create(tweet=t1, tag=tag)
        TweetTag.objects.create(tweet=t2, tag=tag)

        self.assertEqual(TweetTag.objects.filter(tag=tag).count(), 2)
