"""Notification テスト用 factory ヘルパ (Issue #412).

既存の follows / tweets / reactions のスタイルを踏襲した薄い関数ベース factory。
Notification 本体と関連オブジェクト (User, Tweet, Reaction, Follow) を
テストで手軽に生成する。
"""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model

User = get_user_model()


def make_user(**overrides: Any) -> Any:
    """uuid suffix で必ず一意な User を作る。

    handle 正規表現 (英数 + `_` のみ) を満たすため suffix は 12 桁 hex。
    follows/_factories.py / tweets/_factories.py と同じ規約。
    """
    suffix = uuid.uuid4().hex[:12]
    defaults = {
        "username": f"tester{suffix}",
        "email": f"tester-{suffix}@example.com",
        "first_name": "Test",
        "last_name": "User",
    }
    defaults.update(overrides)
    return User.objects.create_user(
        password="pw-unused-for-tests",  # pragma: allowlist secret
        **defaults,
    )


def make_tweet(author: Any = None, body: str = "hello world") -> Any:
    """テスト用 Tweet。author 省略時は新規 User を作る。"""
    from apps.tweets.models import Tweet

    if author is None:
        author = make_user()
    return Tweet.objects.create(author=author, body=body)


def make_reaction(user: Any = None, tweet: Any = None, kind: str = "like") -> Any:
    """テスト用 Reaction。user / tweet 省略時は新規生成する。"""
    from apps.reactions.models import Reaction

    if user is None:
        user = make_user()
    if tweet is None:
        tweet = make_tweet()
    return Reaction.objects.create(user=user, tweet=tweet, kind=kind)


def make_follow(follower: Any = None, followee: Any = None) -> Any:
    """テスト用 Follow。"""
    from apps.follows.models import Follow

    if follower is None:
        follower = make_user()
    if followee is None:
        followee = make_user()
    return Follow.objects.create(follower=follower, followee=followee)


def make_notification(
    recipient: Any = None,
    actor: Any = None,
    kind: str = "like",
    target_type: str = "tweet",
    target_id: Any = None,
    read: bool = False,
) -> Any:
    """テスト用 Notification を直接 ORM で作る。

    service を経由しないため dedup / self-notify guard はかからない。
    service 自体のテスト (test_create_notification.py) では直接 service を呼ぶ。
    """
    from apps.notifications.models import Notification

    if recipient is None:
        recipient = make_user()
    if target_id is None:
        target_id = uuid.uuid4()
    return Notification.objects.create(
        recipient=recipient,
        actor=actor,
        kind=kind,
        target_type=target_type,
        target_id=str(target_id),
        read=read,
    )
