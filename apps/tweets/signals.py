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

import re
from typing import Any

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Greatest
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from apps.common.blocking import safe_notify
from apps.tweets.models import Tweet, TweetType

# #412: mention 抽出の正規表現と上限。spec §12 より handle 数 10 超過時は
# Celery off-load を検討する想定だが、本 Issue では同期処理 + 上限で抑える。
_MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,30})")
MAX_MENTION_NOTIFY = 10


def _bump_field(tweet_pk: int | None, field: str, delta: int) -> None:
    if tweet_pk is None:
        return
    if delta >= 0:
        Tweet.all_objects.filter(pk=tweet_pk).update(**{field: F(field) + delta})
    else:
        Tweet.all_objects.filter(pk=tweet_pk).update(**{field: Greatest(F(field) + delta, 0)})


@receiver(post_save, sender=Tweet)
def on_tweet_created(sender: type[Tweet], instance: Tweet, created: bool, **kwargs: Any) -> None:
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
                # #412: target_type/target_id を追加 (Notification 解決用)
                safe_notify(
                    kind="reply",
                    recipient=reply_to_obj.author,
                    actor=actor,
                    target_type="tweet",
                    target_id=tweet_pk,
                )
        elif target_type == TweetType.QUOTE:
            _bump_field(quote_of_pk, "quote_count", 1)
            if quote_of_obj is not None:
                safe_notify(
                    kind="quote",
                    recipient=quote_of_obj.author,
                    actor=actor,
                    target_type="tweet",
                    target_id=tweet_pk,
                )
        elif target_type == TweetType.REPOST:
            _bump_field(repost_of_pk, "repost_count", 1)
            if repost_of_obj is not None:
                safe_notify(
                    kind="repost",
                    recipient=repost_of_obj.author,
                    actor=actor,
                    target_type="tweet",
                    target_id=tweet_pk,
                )

        # P2-07: OGP fetch を enqueue (URL を含む original / quote / reply が対象)。
        # repost は body=空なので skip。
        if target_type != TweetType.REPOST and body:
            from apps.tweets.ogp import extract_first_url

            if extract_first_url(body):
                from apps.tweets.tasks import fetch_ogp_for_tweet

                fetch_ogp_for_tweet.delay(tweet_pk)

        # #412: mention 抽出 → 各 user に kind=mention 通知。
        # repost は body=空なのでスキップ。reply / quote / mention は重複しても
        # 別 kind なので Notification 行は別。
        if target_type != TweetType.REPOST and body:
            _dispatch_mention_notifications(body=body, actor=actor, tweet_pk=tweet_pk)

        # #311: 投稿者の home TL cache を invalidate。これがないと cache TTL
        # (10 min) 経過まで自分の新規投稿が home に出ない。フォロワーの cache
        # invalidate は fan-out コストが大きいので Phase 4 で fan-out-on-write
        # を検討する際にまとめて対応 (本 PR では author 自身のみ)。
        from apps.timeline.services import invalidate_home_tl

        invalidate_home_tl(actor)

    transaction.on_commit(_bump)


def _dispatch_mention_notifications(*, body: str, actor: Any, tweet_pk: int | None) -> None:
    """body 中の @handle を抽出し、実存する active user に mention 通知を発火.

    自分自身 (`@<actor.handle>`) は self-notify guard で無視される。
    重複 handle は set で排除済。
    spec §12 + python-reviewer MED: handle 数の上限を MAX_MENTION_NOTIFY (=10) で
    cap。それ以上は Celery off-load を別 Issue で対応する。
    """
    handles = {m.group(1) for m in _MENTION_RE.finditer(body)}
    if not handles:
        return
    from django.contrib.auth import get_user_model

    User = get_user_model()
    users = User.objects.filter(username__in=handles, is_active=True)[:MAX_MENTION_NOTIFY]
    for user in users:
        safe_notify(
            kind="mention",
            recipient=user,
            actor=actor,
            target_type="tweet",
            target_id=tweet_pk,
        )


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
