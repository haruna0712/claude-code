"""Boards services (Phase 5 / Issue #426).

Thread / ThreadPost のドメインロジックを集約する。view からは必ず
このサービス層を経由して書き込みを行うこと (採番・lock 遷移の整合性)。

**主要 API**:
- :func:`append_post` — レスを追加し、`Thread.post_count` / `last_post_at` /
  `locked` を原子的に更新する。`select_for_update` で並行投稿による
  採番衝突を防ぐ。
- :func:`create_thread_with_first_post` — Thread と 1 レス目を 1 transaction で
  生成。失敗時は Thread ごと rollback。
- :func:`compute_thread_state` — 990 警告 / 1000 lock 判定を view 側で
  使うためのユーティリティ。
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from django.db import transaction
from django.utils import timezone

from apps.boards.models import Thread, ThreadPost, ThreadPostImage

#: 1 スレッドあたりの上限レス数 (SPEC §11.2)。
THREAD_POST_HARD_LIMIT: int = 1000

#: 990 レスで「残りわずかです」バナーを出すための閾値。
THREAD_POST_WARNING_LIMIT: int = 990

#: 1 レスあたりの画像最大枚数。
THREAD_POST_MAX_IMAGES: int = 4


class ThreadLocked(Exception):
    """1000 レス到達 / 管理者操作で投稿不可になっているスレへの書き込み試行."""


def compute_thread_state(*, post_count: int, locked: bool) -> dict[str, Any]:
    """frontend に返す ``thread_state`` フラグを組み立てる.

    Args:
        post_count: 現時点の `Thread.post_count`.
        locked: 現時点の `Thread.locked`.

    Returns:
        ``{post_count, locked, approaching_limit}``
    """
    approaching = post_count >= THREAD_POST_WARNING_LIMIT
    return {
        "post_count": post_count,
        "locked": bool(locked),
        "approaching_limit": approaching,
    }


@transaction.atomic
def append_post(
    thread: Thread,
    author: Any,
    body: str,
    images: Iterable[dict[str, Any]] = (),
) -> ThreadPost:
    """スレッドにレスを追加する (採番 / lock 遷移込み)。

    並列実行で `number` が衝突しないよう ``select_for_update`` で行ロックを取り、
    ``post_count + 1`` で採番する。1000 件目で `locked=True` を立てる。

    Args:
        thread: 追加対象のスレッド。
        author: 投稿者。
        body: 本文 (`max_length=5000`)。
        images: 添付画像 dict のイテラブル。各要素は
            `{image_url, width, height, order}` を持つ。
            5 枚目以降は無視される。

    Raises:
        ThreadLocked: スレッドが既にロックされている、または `post_count` が
            上限に達している場合。
    """
    locked_thread = Thread.objects.select_for_update().get(pk=thread.pk)
    if locked_thread.locked or locked_thread.post_count >= THREAD_POST_HARD_LIMIT:
        # `post_count == HARD_LIMIT` だが `locked=False` の異常系もここで弾く。
        # 副作用で locked=True を立てて後続も止める。
        if not locked_thread.locked and locked_thread.post_count >= THREAD_POST_HARD_LIMIT:
            Thread.objects.filter(pk=locked_thread.pk).update(locked=True)
        raise ThreadLocked()

    next_number = locked_thread.post_count + 1
    post = ThreadPost.objects.create(
        thread=locked_thread,
        author=author,
        number=next_number,
        body=body,
    )

    capped_images = list(images)[:THREAD_POST_MAX_IMAGES]
    for img in capped_images:
        ThreadPostImage.objects.create(post=post, **img)

    new_locked = next_number >= THREAD_POST_HARD_LIMIT
    Thread.objects.filter(pk=locked_thread.pk).update(
        post_count=next_number,
        last_post_at=timezone.now(),
        locked=new_locked,
    )

    # メンション通知は commit 後に発火 (rollback 時に幽霊通知を作らない)。
    transaction.on_commit(lambda p=post: _emit_mentions_safely(p))

    return post


def _emit_mentions_safely(post: ThreadPost) -> None:
    """on_commit から呼ぶ薄いラッパ。通知側の例外で primary action を阻まない."""
    try:
        from apps.boards.mentions import emit_mention_notifications

        emit_mention_notifications(post)
    except Exception:  # pragma: no cover - notifications app 失敗時
        import logging

        logging.getLogger(__name__).exception(
            "emit_mention_notifications failed", extra={"post_id": post.pk}
        )


@transaction.atomic
def create_thread_with_first_post(
    *,
    board: Any,
    author: Any,
    title: str,
    body: str,
    images: Iterable[dict[str, Any]] = (),
) -> tuple[Thread, ThreadPost]:
    """Thread を作成し、1 レス目を同 transaction で投入する.

    `body` か images の検証で失敗した場合は Thread の作成も rollback される。
    """
    now = timezone.now()
    thread = Thread.objects.create(
        board=board,
        author=author,
        title=title,
        post_count=0,
        last_post_at=now,
        locked=False,
    )
    first_post = append_post(thread, author, body, images=images)
    # append_post が post_count=1 / last_post_at=now2 に更新済み。
    thread.refresh_from_db()
    return thread, first_post
