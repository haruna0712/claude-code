"""TweetImage のテスト (P1-07)。

- 4 枚まで OK、5 枚目は clean() で ValidationError
- (tweet, order) ユニーク制約
"""

from __future__ import annotations

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.tweets.models import TWEET_MAX_IMAGES, TweetImage
from apps.tweets.tests._factories import make_tweet


def _make_image(tweet, order: int) -> TweetImage:
    return TweetImage.objects.create(
        tweet=tweet,
        image_url=f"https://example.com/img-{order}.png",
        width=800,
        height=600,
        order=order,
    )


class TweetImageLimitTests(TestCase):
    """添付枚数の上限 (4)。"""

    def test_up_to_four_images_allowed(self) -> None:
        tweet = make_tweet()
        for i in range(TWEET_MAX_IMAGES):
            _make_image(tweet, i)

        self.assertEqual(tweet.images.count(), TWEET_MAX_IMAGES)

    def test_fifth_image_raises_validation_error(self) -> None:
        tweet = make_tweet()
        for i in range(TWEET_MAX_IMAGES):
            _make_image(tweet, i)

        # 5 枚目を clean() で弾く
        fifth = TweetImage(
            tweet=tweet,
            image_url="https://example.com/img-4.png",
            width=800,
            height=600,
            order=4,
        )
        with self.assertRaises(ValidationError):
            fifth.full_clean()


class TweetImageOrderUniqueTests(TestCase):
    """(tweet, order) のユニーク制約。"""

    def test_order_must_be_unique_per_tweet(self) -> None:
        tweet = make_tweet()
        _make_image(tweet, 0)

        with self.assertRaises(IntegrityError), transaction.atomic():
            _make_image(tweet, 0)

    def test_same_order_allowed_across_different_tweets(self) -> None:
        t1 = make_tweet()
        t2 = make_tweet(author=t1.author)

        _make_image(t1, 0)
        _make_image(t2, 0)

        self.assertEqual(TweetImage.objects.filter(order=0).count(), 2)

    def test_images_ordered_by_order_field(self) -> None:
        tweet = make_tweet()
        _make_image(tweet, 2)
        _make_image(tweet, 0)
        _make_image(tweet, 1)

        orders = list(tweet.images.values_list("order", flat=True))
        self.assertEqual(orders, [0, 1, 2])
