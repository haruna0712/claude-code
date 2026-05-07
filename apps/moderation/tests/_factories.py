"""Moderation テスト用 factory ヘルパ (Phase 4B)."""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model

User = get_user_model()


def make_user(**overrides: Any) -> Any:
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


def make_block(blocker: Any = None, blockee: Any = None) -> Any:
    from apps.moderation.models import Block

    if blocker is None:
        blocker = make_user()
    if blockee is None:
        blockee = make_user()
    return Block.objects.create(blocker=blocker, blockee=blockee)


def make_mute(muter: Any = None, mutee: Any = None) -> Any:
    from apps.moderation.models import Mute

    if muter is None:
        muter = make_user()
    if mutee is None:
        mutee = make_user()
    return Mute.objects.create(muter=muter, mutee=mutee)
