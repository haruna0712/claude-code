"""Tweet create / publish 時の副作用群 helper (#770)。

post_save signal (`on_tweet_created`) と publish action の両方から呼ばれ、
公開時に 1 回だけ以下の副作用を発火する:

- reply / quote / repost の counter bump (= ORIGINAL なら no-op)
- mention notification dispatch
- OGP fetch celery enqueue (URL があれば)
- home TL cache invalidate (author のみ)

#770 fix: draft (= published_at IS NULL) では絶対に呼ばれてはいけない。
caller (signal handler / publish action) が `published_at IS NOT NULL` を保証
した上で `transaction.on_commit` 内で `emit_create_side_effects(tweet_pk)` を
call する。 defense-in-depth で関数冒頭でも `published_at` を確認する。

python-reviewer HIGH (#770 review): caller が pk を渡し、 helper 内で
`Tweet.all_objects.get(pk)` で fresh fetch することで `instance` の mutable
キャプチャ問題 (= lambda closure 内で別 mutator に上書きされる) を排除する。
"""

from __future__ import annotations

import logging
import re
from typing import Any

from django.db.models import F
from django.db.models.functions import Greatest

from apps.common.blocking import safe_notify
from apps.tweets.models import Tweet, TweetType

logger = logging.getLogger(__name__)

# #412: mention 抽出の正規表現と上限。spec §12 より handle 数 10 超過時は
# Celery off-load を検討する想定だが、本 Issue では同期処理 + 上限で抑える。
_MENTION_RE = re.compile(r"(?<![A-Za-z0-9_])@([A-Za-z0-9_]{3,30})")
MAX_MENTION_NOTIFY = 10


def bump_field(tweet_pk: int | None, field: str, delta: int) -> None:
    if tweet_pk is None:
        return
    if delta >= 0:
        Tweet.all_objects.filter(pk=tweet_pk).update(**{field: F(field) + delta})
    else:
        Tweet.all_objects.filter(pk=tweet_pk).update(**{field: Greatest(F(field) + delta, 0)})


def emit_create_side_effects(tweet_pk: int) -> None:
    """tweet 公開時の副作用群を発火する (signal handler / publish action 共通)。

    呼び出し元 (= transaction.on_commit 内で実行される想定):
    - `on_tweet_created` (post_save signal): published_at IS NOT NULL の create でのみ呼ぶ
    - `TweetViewSet.publish` action: draft → publish の遷移直後に呼ぶ

    #770 python-reviewer HIGH: caller の lambda closure で mutable instance を
    つかむのではなく pk を渡してもらい、 ここで fresh fetch する。 これにより
    refresh_from_db 後の他処理で instance が再 mutate されても影響を受けない。

    #770 python-reviewer HIGH: defense-in-depth で `published_at IS NULL` の
    tweet なら ValueError を投げる (silent な誤呼出を loud にする)。
    """
    try:
        instance = Tweet.all_objects.get(pk=tweet_pk)
    except Tweet.DoesNotExist:
        # tweet が transaction commit 後に削除されたケース (= rare)。
        # silent skip でよい (= 副作用を発火しても意味がない)。
        return

    if instance.published_at is None:
        # code-reviewer MEDIUM: Django は ``transaction.on_commit`` callback 内の
        # 例外を silent に swallow するので、 ValueError raise だけでは Sentry に
        # 届かない。 明示的に error ログを残してから raise する。
        msg = f"emit_create_side_effects called on unpublished tweet pk={tweet_pk}"
        logger.error(msg)
        raise ValueError(msg)

    actor = instance.author
    target_type = instance.type
    reply_to_pk = instance.reply_to_id
    quote_of_pk = instance.quote_of_id
    repost_of_pk = instance.repost_of_id
    reply_to_obj = instance.reply_to
    quote_of_obj = instance.quote_of
    repost_of_obj = instance.repost_of
    body = instance.body

    if target_type == TweetType.REPLY:
        bump_field(reply_to_pk, "reply_count", 1)
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
        bump_field(quote_of_pk, "quote_count", 1)
        if quote_of_obj is not None:
            safe_notify(
                kind="quote",
                recipient=quote_of_obj.author,
                actor=actor,
                target_type="tweet",
                target_id=tweet_pk,
            )
    elif target_type == TweetType.REPOST:
        bump_field(repost_of_pk, "repost_count", 1)
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
        from apps.tweets.tasks import fetch_ogp_for_tweet

        if extract_first_url(body):
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
