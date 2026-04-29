"""Follow テスト用 factory (P2-03 / GitHub #178).

apps.tweets.tests._factories と同じスタイル。pytest-factoryboy を入れる前提だが
薄いヘルパーで十分なケースが多いのでここでは関数ベース。
"""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model

from apps.follows.models import Follow

User = get_user_model()


def make_user(**overrides: Any) -> Any:
    """uuid suffix で必ず一意な User を作る。

    handle 正規表現 (英数 + `_` のみ) を満たすため suffix は 12 桁 hex (英数のみ)。
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


def make_follow(follower: Any, followee: Any) -> Follow:
    return Follow.objects.create(follower=follower, followee=followee)
