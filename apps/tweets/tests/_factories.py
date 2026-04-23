"""テスト用のファクトリヘルパ。

pytest-factoryboy を入れる前のフェーズなので、薄いヘルパーだけ用意する。
外部 app (tags, users) の都合を隔離し、テスト本体が簡潔になるようにする。
"""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model

from apps.tags.models import Tag  # type: ignore[attr-defined]
from apps.tweets.models import Tweet

User = get_user_model()


def make_user(**overrides: Any) -> Any:
    """テスト用ユーザーを作る薄いヘルパ。

    email / username は一意でなければいけないため、呼び出し側で
    必ず衝突しない値を渡すか ``overrides`` で上書きすること。
    """

    defaults = {
        "username": "tester",
        "email": "tester@example.com",
        "first_name": "Test",
        "last_name": "User",
    }
    defaults.update(overrides)
    return User.objects.create_user(password="pw-unused-for-tests", **defaults)


def make_tag(name: str = "python", display_name: str | None = None) -> Tag:
    """テスト用タグ。"""

    return Tag.objects.create(
        name=name,
        display_name=display_name or name.capitalize(),
    )


def make_tweet(author=None, body: str = "hello world") -> Tweet:
    """テスト用ツイート。

    ``author`` が省略された場合は新しいユーザを作る。
    """

    if author is None:
        author = make_user()
    return Tweet.objects.create(author=author, body=body)
