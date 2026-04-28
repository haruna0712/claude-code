"""Tweet signals (P2-05 / GitHub #180).

reply / repost / quote の元ツイートの各 count を更新する。
db H-1: ``transaction.on_commit`` で commit 後に F() ± 1 を発行 (drift 防止)。
arch H-2: type=repost で repost_of が同じツイートに対する重複 RT は DB の
partial UniqueConstraint で reject されるため、signal はそのまま +1 して良い。

通知発火 (Phase 4 まで疎結合 try/except):
- reply  → reply_to.author に Notification(kind=REPLY)
- repost → repost_of.author に Notification(kind=REPOST)
- quote  → quote_of.author に Notification(kind=QUOTE)
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.blocking import safe_notify
from apps.tweets.models import Tweet, TweetType


def _bump_field(tweet_pk: int | None, field: str, delta: int) -> None:
    if tweet_pk is None:
        return
    if delta >= 0:
        Tweet.all_objects.filter(pk=tweet_pk).update(**{field: F(field) + delta})
    else:
        Tweet.all_objects.filter(pk=tweet_pk).update(
            **{field: Greatest(F(field) + delta, 0)}
        )


@receiver(post_save, sender=Tweet)
def on_tweet_created(
    sender: type[Tweet], instance: Tweet, created: bool, **kwargs: Any
) -> None:
    """Reply / Repost / Quote 作成時に元ツイートの count を +1.

    P2-07: 本文に URL があれば OGP 取得タスクを enqueue する.
    """
    if not created:
        return
    actor = instance.author
    target_type = instance.type
    reply_to_pk = instance.reply_to_id
    quote_of_pk = instance.quote_of_id
    repost_of_pk = instance.repost_of_id
    reply_to_obj = instance.reply_to
    quote_of_obj = instance.quote_of
    repost_of_obj = instance.repost_of
    tweet_pk = instance.pk
    body = instance.body

    def _bump() -> None:
        if target_type == TweetType.REPLY:
            _bump_field(reply_to_pk, "reply_count", 1)
            if reply_to_obj is not None:
                safe_notify(kind="REPLY", recipient=reply_to_obj.author, actor=actor)
        elif target_type == TweetType.QUOTE:
            _bump_field(quote_of_pk, "quote_count", 1)
            if quote_of_obj is not None:
                safe_notify(kind="QUOTE", recipient=quote_of_obj.author, actor=actor)
        elif target_type == TweetType.REPOST:
            _bump_field(repost_of_pk, "repost_count", 1)
            if repost_of_obj is not None:
                safe_notify(kind="REPOST", recipient=repost_of_obj.author, actor=actor)

        # P2-07: OGP fetch を enqueue (URL を含む original / quote / reply が対象)。
        # repost は body=空なので skip。
        if target_type != TweetType.REPOST and body:
            from apps.tweets.ogp import extract_first_url

            if extract_first_url(body):
                from apps.tweets.tasks import fetch_ogp_for_tweet

                fetch_ogp_for_tweet.delay(tweet_pk)

    transaction.on_commit(_bump)


@receiver(post_delete, sender=Tweet)
def on_tweet_deleted(sender: type[Tweet], instance: Tweet, **kwargs: Any) -> None:
    """Reply / Repost / Quote 削除時に元ツイートの count を -1 (0 でクリップ)."""
    target_type = instance.type
    reply_to_pk = instance.reply_to_id
    quote_of_pk = instance.quote_of_id
    repost_of_pk = instance.repost_of_id

    def _bump() -> None:
        if target_type == TweetType.REPLY:
            _bump_field(reply_to_pk, "reply_count", -1)
        elif target_type == TweetType.QUOTE:
            _bump_field(quote_of_pk, "quote_count", -1)
        elif target_type == TweetType.REPOST:
            _bump_field(repost_of_pk, "repost_count", -1)

    transaction.on_commit(_bump)
