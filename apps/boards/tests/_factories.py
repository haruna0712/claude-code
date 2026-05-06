"""Boards テスト用 factory ヘルパ (Phase 5 / Issue #425).

apps.notifications.tests._factories と同パターン。
Board / Thread / ThreadPost / ThreadPostImage を最小コストで作る。
"""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model
from django.utils import timezone

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


def make_board(slug: str | None = None, name: str | None = None, **overrides: Any) -> Any:
    """テスト用 Board を作る。slug 省略時は uuid suffix で衝突回避。"""
    from apps.boards.models import Board

    suffix = uuid.uuid4().hex[:8]
    defaults = {
        "slug": slug or f"board-{suffix}",
        "name": name or f"Board {suffix}",
        "description": "test board",
        "order": 0,
        "color": "#3b82f6",
    }
    defaults.update(overrides)
    return Board.objects.create(**defaults)


def make_thread(
    board: Any = None,
    author: Any = None,
    title: str = "Test thread",
    **overrides: Any,
) -> Any:
    """テスト用 Thread を作る。post_count=0 / locked=False 既定。"""
    from apps.boards.models import Thread

    if board is None:
        board = make_board()
    if author is None:
        author = make_user()
    defaults = {
        "board": board,
        "author": author,
        "title": title,
        "post_count": 0,
        "last_post_at": timezone.now(),
        "locked": False,
    }
    defaults.update(overrides)
    return Thread.objects.create(**defaults)


def make_thread_post(
    thread: Any = None,
    author: Any = None,
    body: str = "test post",
    number: int | None = None,
    **overrides: Any,
) -> Any:
    """テスト用 ThreadPost を作る。

    NOTE: 通常は services.append_post を使うこと。本 helper は単体テストで
    モデル制約を直接検証するときの逃げ道。
    """
    from apps.boards.models import ThreadPost

    if thread is None:
        thread = make_thread()
    if author is None:
        author = make_user()
    if number is None:
        number = (thread.posts.count() if thread.pk else 0) + 1
    defaults = {
        "thread": thread,
        "author": author,
        "number": number,
        "body": body,
    }
    defaults.update(overrides)
    return ThreadPost.objects.create(**defaults)
