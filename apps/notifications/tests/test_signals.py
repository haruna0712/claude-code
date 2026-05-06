"""Signal integration tests for notification firing (Issue #412 — RED phase).

transaction.on_commit が実際に発火するよう
`@pytest.mark.django_db(transaction=True)` を全クラス / 関数に付ける。
(Phase 2 の reaction signals テストで踏んだ罠: transaction=False だと
on_commit コールバックが test commit ではなく savepoint で止まって発火しない。)

テストはすべて RED (実装前) の状態で fail する。
model / service / signals の実装後に GREEN になる。
"""

from __future__ import annotations

import pytest

# RED: model 未実装のため ImportError になる。
from apps.notifications.models import Notification, NotificationKind
from apps.notifications.tests._factories import make_tweet, make_user

# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _count_notifications(recipient, kind: str) -> int:
    return Notification.objects.filter(recipient=recipient, kind=kind).count()


def _get_notification(recipient, kind: str):
    return Notification.objects.filter(recipient=recipient, kind=kind).first()


# ---------------------------------------------------------------------------
# LIKE signal — apps/reactions/signals.py::on_reaction_saved
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestLikeSignal:
    """Reaction 作成で kind=LIKE 通知が発火する。"""

    def test_reaction_create_fires_like_notification(self) -> None:
        """reaction.create で author に kind=LIKE 通知が作られる。"""
        # Arrange
        author = make_user()
        actor = make_user()
        tweet = make_tweet(author=author)

        # Act — Reaction.objects.create が post_save → on_commit → safe_notify を発火
        from apps.reactions.models import Reaction

        Reaction.objects.create(user=actor, tweet=tweet, kind="like")

        # Assert
        notif = _get_notification(recipient=author, kind=NotificationKind.LIKE)
        assert notif is not None
        assert notif.actor_id == actor.pk
        assert notif.target_type == "tweet"
        assert notif.target_id == str(tweet.id)

    def test_self_reaction_does_not_fire_notification(self) -> None:
        """自分の tweet に自分で reaction しても通知は作られない。"""
        # Arrange
        user = make_user()
        tweet = make_tweet(author=user)

        # Act
        from apps.reactions.models import Reaction

        Reaction.objects.create(user=user, tweet=tweet, kind="like")

        # Assert
        assert _count_notifications(recipient=user, kind=NotificationKind.LIKE) == 0

    def test_reaction_kind_update_does_not_fire_duplicate_notification(self) -> None:
        """Reaction の kind 変更 (UPDATE) では新たな LIKE 通知は発火しない。

        on_reaction_saved は `created=False` の場合に early return するため。
        """
        # Arrange
        author = make_user()
        actor = make_user()
        tweet = make_tweet(author=author)
        from apps.reactions.models import Reaction

        reaction = Reaction.objects.create(user=actor, tweet=tweet, kind="like")
        initial_count = _count_notifications(recipient=author, kind=NotificationKind.LIKE)

        # Act — kind 変更 (UPDATE)
        reaction.kind = "interesting"
        reaction.save(update_fields=["kind", "updated_at"])

        # Assert
        assert _count_notifications(recipient=author, kind=NotificationKind.LIKE) == initial_count


# ---------------------------------------------------------------------------
# REPLY signal — apps/tweets/signals.py::on_tweet_created
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestReplySignal:
    """tweet type=REPLY で kind=REPLY 通知が発火する。"""

    def test_reply_tweet_fires_reply_notification(self) -> None:
        """reply ツイート作成で reply_to.author に kind=REPLY 通知が作られる。"""
        # Arrange
        original_author = make_user()
        replier = make_user()
        original_tweet = make_tweet(author=original_author, body="original")
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=replier,
            body=f"@{original_author.username} reply",
            type=TweetType.REPLY,
            reply_to=original_tweet,
        )

        # Assert
        notif = _get_notification(recipient=original_author, kind=NotificationKind.REPLY)
        assert notif is not None
        assert notif.actor_id == replier.pk

    def test_self_reply_does_not_fire_notification(self) -> None:
        """自分のツイートへの自己 reply は通知しない。"""
        # Arrange
        user = make_user()
        tweet = make_tweet(author=user)
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=user,
            body="self reply",
            type=TweetType.REPLY,
            reply_to=tweet,
        )

        # Assert
        assert _count_notifications(recipient=user, kind=NotificationKind.REPLY) == 0


# ---------------------------------------------------------------------------
# QUOTE signal — apps/tweets/signals.py::on_tweet_created
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestQuoteSignal:
    """tweet type=QUOTE で kind=QUOTE 通知が発火する。"""

    def test_quote_tweet_fires_quote_notification(self) -> None:
        """quote ツイート作成で quote_of.author に kind=QUOTE 通知が作られる。"""
        # Arrange
        original_author = make_user()
        quoter = make_user()
        original_tweet = make_tweet(author=original_author)
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=quoter,
            body="quoting",
            type=TweetType.QUOTE,
            quote_of=original_tweet,
        )

        # Assert
        notif = _get_notification(recipient=original_author, kind=NotificationKind.QUOTE)
        assert notif is not None
        assert notif.actor_id == quoter.pk

    def test_self_quote_does_not_fire_notification(self) -> None:
        """自分のツイートへの自己 quote は通知しない。"""
        # Arrange
        user = make_user()
        tweet = make_tweet(author=user)
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=user,
            body="self quote",
            type=TweetType.QUOTE,
            quote_of=tweet,
        )

        # Assert
        assert _count_notifications(recipient=user, kind=NotificationKind.QUOTE) == 0


# ---------------------------------------------------------------------------
# REPOST signal — apps/tweets/signals.py::on_tweet_created
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestRepostSignal:
    """tweet type=REPOST で kind=REPOST 通知が発火する。"""

    def test_repost_tweet_fires_repost_notification(self) -> None:
        """repost ツイート作成で repost_of.author に kind=REPOST 通知が作られる。"""
        # Arrange
        original_author = make_user()
        reposter = make_user()
        original_tweet = make_tweet(author=original_author)
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=reposter,
            body="",
            type=TweetType.REPOST,
            repost_of=original_tweet,
        )

        # Assert
        notif = _get_notification(recipient=original_author, kind=NotificationKind.REPOST)
        assert notif is not None
        assert notif.actor_id == reposter.pk

    def test_self_repost_does_not_fire_notification(self) -> None:
        """自分のツイートの自己 repost は通知しない。"""
        # Arrange
        user = make_user()
        tweet = make_tweet(author=user)
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=user,
            body="",
            type=TweetType.REPOST,
            repost_of=tweet,
        )

        # Assert
        assert _count_notifications(recipient=user, kind=NotificationKind.REPOST) == 0


# ---------------------------------------------------------------------------
# MENTION signal — apps/tweets/signals.py::on_tweet_created (新規追加)
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestMentionSignal:
    """tweet 本文の @handle 抽出で kind=MENTION 通知が発火する。"""

    def test_mention_fires_notification_for_mentioned_user(self) -> None:
        """本文 @alice で alice に kind=MENTION 通知が作られる。"""
        # Arrange
        alice = make_user(username="alice")
        poster = make_user()
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=poster,
            body="@alice こんにちは",
            type=TweetType.ORIGINAL,
        )

        # Assert
        notif = _get_notification(recipient=alice, kind=NotificationKind.MENTION)
        assert notif is not None
        assert notif.actor_id == poster.pk

    def test_mention_multiple_users(self) -> None:
        """本文 "@alice こんにちは @bob" で alice / bob 両方に MENTION 通知が作られる。"""
        # Arrange
        alice = make_user(username="alice2")
        bob = make_user(username="bob2")
        poster = make_user()
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=poster,
            body="@alice2 こんにちは @bob2",
            type=TweetType.ORIGINAL,
        )

        # Assert
        assert _count_notifications(recipient=alice, kind=NotificationKind.MENTION) == 1
        assert _count_notifications(recipient=bob, kind=NotificationKind.MENTION) == 1

    def test_duplicate_handle_in_body_fires_only_once(self) -> None:
        """本文 "@alice @alice" でも alice への MENTION は 1 件のみ。"""
        # Arrange
        alice = make_user(username="alice3")
        poster = make_user()
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=poster,
            body="@alice3 hello @alice3",
            type=TweetType.ORIGINAL,
        )

        # Assert
        assert _count_notifications(recipient=alice, kind=NotificationKind.MENTION) == 1

    def test_nonexistent_handle_is_ignored(self) -> None:
        """存在しない @handle は無視され通知が作られない。"""
        # Arrange
        poster = make_user()
        initial_count = Notification.objects.filter(kind=NotificationKind.MENTION).count()
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=poster,
            body="@nonexistent_handle_xyz",
            type=TweetType.ORIGINAL,
        )

        # Assert
        assert Notification.objects.filter(kind=NotificationKind.MENTION).count() == initial_count

    def test_self_mention_is_not_notified(self) -> None:
        """自分自身への @mention は self-notify guard で通知されない。"""
        # Arrange
        user = make_user(username="selfmentioner")
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=user,
            body="@selfmentioner hello",
            type=TweetType.ORIGINAL,
        )

        # Assert
        # self-notify guard (actor == recipient) により 0 件
        assert _count_notifications(recipient=user, kind=NotificationKind.MENTION) == 0

    def test_email_at_sign_not_extracted_as_mention(self) -> None:
        """email@example.com の @example は mention として抽出されない。

        MENTION_RE の lookbehind で直前が英数字なら除外される仕様 (spec §5.1)。
        """
        # Arrange
        # もし @example というユーザが存在しても通知は届かないことを確認
        example_user = make_user(username="example")
        poster = make_user()
        from apps.tweets.models import Tweet, TweetType

        # Act
        Tweet.objects.create(
            author=poster,
            body="contact: mail@example.com for help",
            type=TweetType.ORIGINAL,
        )

        # Assert
        assert _count_notifications(recipient=example_user, kind=NotificationKind.MENTION) == 0

    def test_mention_target_type_is_tweet(self) -> None:
        """MENTION 通知の target_type が "tweet" で target_id が tweet.id。"""
        # Arrange
        alice = make_user(username="alice4")
        poster = make_user()
        from apps.tweets.models import Tweet, TweetType

        # Act
        tweet = Tweet.objects.create(
            author=poster,
            body="@alice4 check this",
            type=TweetType.ORIGINAL,
        )

        # Assert
        notif = _get_notification(recipient=alice, kind=NotificationKind.MENTION)
        assert notif is not None
        assert notif.target_type == "tweet"
        assert notif.target_id == str(tweet.id)


# ---------------------------------------------------------------------------
# FOLLOW signal — apps/follows/signals.py::on_follow_created
# ---------------------------------------------------------------------------


@pytest.mark.django_db(transaction=True)
class TestFollowSignal:
    """Follow 作成で kind=FOLLOW 通知が発火する。"""

    def test_follow_fires_follow_notification(self) -> None:
        """follow.create で followee に kind=FOLLOW 通知が作られる。"""
        # Arrange
        follower = make_user()
        followee = make_user()

        # Act
        from apps.follows.models import Follow

        Follow.objects.create(follower=follower, followee=followee)

        # Assert
        notif = _get_notification(recipient=followee, kind=NotificationKind.FOLLOW)
        assert notif is not None
        assert notif.actor_id == follower.pk
        assert notif.target_type == "user"
        assert notif.target_id == str(followee.id)

    def test_self_follow_does_not_fire_notification(self) -> None:
        """自己フォロー (仮に許可されても) は通知しない。

        Follow モデルに自己フォロー制約がある場合は DB エラーが先に起きるが、
        safe_notify の self-notify guard でも防御される。
        通知層の責務として確認する。
        """
        # Arrange
        user = make_user()

        # Act: self-follow は DB constraint でブロックされる可能性があるため
        # safe_notify を直接テストする代わりに、follow signal が受け取るシナリオを
        # create_notification 経由で検証する。
        from apps.notifications.services import create_notification

        result = create_notification(
            kind=NotificationKind.FOLLOW,
            recipient=user,
            actor=user,
            target_type="user",
            target_id=str(user.id),
        )

        # Assert
        assert result is None
        assert _count_notifications(recipient=user, kind=NotificationKind.FOLLOW) == 0
