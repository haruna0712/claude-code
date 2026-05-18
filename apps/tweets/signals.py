"""Tweet signals (P2-05 / GitHub #180).

reply / repost / quote の元ツイートの各 count を更新する。
db H-1: ``transaction.on_commit`` で commit 後に F() ± 1 を発行 (drift 防止)。
arch H-2: type=repost で repost_of が同じツイートに対する重複 RT は DB の
partial UniqueConstraint で reject されるため、signal はそのまま +1 して良い。

通知発火 (Phase 4 まで疎結合 try/except):
- reply  → reply_to.author に Notification(kind=REPLY)
- repost → repost_of.author に Notification(kind=REPOST)
- quote  → quote_of.author に Notification(kind=QUOTE)

#770: create / publish 時の副作用群 (mention 通知 / counter bump / OGP / TL
cache invalidate) は ``apps/tweets/side_effects.py`` の
``emit_create_side_effects(tweet_pk)`` に集約し、 signal handler と publish
action の両方から `transaction.on_commit` で 1 回だけ call する。
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from apps.tweets.language_detection import detect_language
from apps.tweets.models import Tweet, TweetType
from apps.tweets.side_effects import _bump_field, emit_create_side_effects


@receiver(post_save, sender=Tweet)
def on_tweet_created(sender: type[Tweet], instance: Tweet, created: bool, **kwargs: Any) -> None:
    """published tweet の作成時に副作用群を発火する。

    P2-07: 本文に URL があれば OGP 取得タスクを enqueue する.

    #770 fix: draft (published_at IS NULL) 作成時は副作用を発火させない。
    mention 通知 / counter bump / OGP fetch / home TL cache invalidate はすべて
    公開時 (= publish action 内で `emit_create_side_effects` を手動 call) に
    1 回だけ発火する。
    """
    if not created:
        return
    # #770: draft で副作用 skip。 publish action 側で手動 call される。
    if instance.published_at is None:
        return
    # python-reviewer HIGH (#770): lambda closure で mutable instance を握らず
    # pk を渡して on_commit 内で fresh fetch する。 これにより refresh_from_db
    # 後の他処理で instance が上書きされても影響を受けない。
    tweet_pk = instance.pk
    transaction.on_commit(lambda: emit_create_side_effects(tweet_pk))


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


# ---------------------------------------------------------------------------
# Phase 13 P13-01: 言語自動検出 (langdetect で本文から言語コードを推定)
# ---------------------------------------------------------------------------


@receiver(pre_save, sender=Tweet)
def auto_detect_language(sender: type[Tweet], instance: Tweet, **kwargs: Any) -> None:
    """投稿 / 編集時に Tweet.body の言語を検出して language field に保存。

    動作:
    - 新規 (`pk is None`) で `language` が既にセットされている → caller が
      明示指定したと判断して尊重 (data migration / fixture 用途)
    - 新規で `language` が None → 検出して set
    - 既存 (`pk` あり) で body が変わっていたら再検出
    - 既存で body 変わらず → そのまま (検出 cost 削減)
    """

    body = instance.body or ""
    if not body:
        return

    if instance.pk is None:
        if instance.language is not None:
            # 明示指定された値を尊重
            return
        instance.language = detect_language(body)
        return

    # 既存 instance: DB の old body と比較して、 body が変わっていたら再検出
    try:
        old_body = Tweet.all_objects.values_list("body", flat=True).get(pk=instance.pk)
    except Tweet.DoesNotExist:
        instance.language = detect_language(body)
        return
    if old_body == body:
        # body 不変 → language も触らない (caller が明示変更した場合も尊重)
        return
    instance.language = detect_language(body)
