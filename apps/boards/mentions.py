"""@handle メンション抽出 + 通知発火 (Phase 5 / Issue #431).

ThreadPost 本文から `@handle` を抽出し、Phase 4A の通知サービスに流す。
"""

from __future__ import annotations

import logging
import re
from typing import Any

from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)

#: @handle 正規表現。SPEC §2.2 の handle 仕様 (英数 + `_`、3〜30 字) に揃える。
MENTION_RE = re.compile(r"@([A-Za-z0-9_]{3,30})")

#: 1 レスあたり通知する最大ユーザー数 (Phase 4A の `MAX_MENTION_NOTIFY` と整合)。
MAX_MENTION_NOTIFY: int = 10


def extract_mentions(body: str) -> list[str]:
    """`@handle` を順序を保ちつつ重複除去して返す."""
    seen: set[str] = set()
    out: list[str] = []
    if not body:
        return out
    for m in MENTION_RE.finditer(body):
        h = m.group(1)
        if h not in seen:
            seen.add(h)
            out.append(h)
    return out


def emit_mention_notifications(post: Any) -> None:
    """ThreadPost に対して mention 通知を作成する.

    - 自己メンションは無視
    - 存在しない handle は無視
    - 重複 handle は 1 件にまとめる
    - 同 body 内で `MAX_MENTION_NOTIFY` 件を超えた分は無視
    - NotificationSetting で `mention=False` のユーザーは通知層側で skip される

    通知層の import は遅延 (notifications app が無くても boards が壊れないように)。
    """
    handles = extract_mentions(post.body or "")
    if not handles:
        return

    User = get_user_model()
    users = list(User.objects.filter(username__in=handles[: MAX_MENTION_NOTIFY * 2]))
    # 順序を handle の登場順に揃える (テストしやすさ + UI の予測可能性)
    by_handle = {u.username: u for u in users}

    try:
        from apps.notifications.models import NotificationKind
        from apps.notifications.services import create_notification
    except ImportError:  # pragma: no cover - notifications app 未マウント時
        logger.warning("apps.notifications not available; skipping mention notifications")
        return

    notified = 0
    author = post.author
    author_pk = getattr(author, "pk", None) if author is not None else None
    for handle in handles:
        if notified >= MAX_MENTION_NOTIFY:
            break
        recipient = by_handle.get(handle)
        if recipient is None:
            continue
        if author_pk is not None and recipient.pk == author_pk:
            continue
        create_notification(
            kind=NotificationKind.MENTION,
            recipient=recipient,
            actor=author,
            target_type="thread_post",
            target_id=post.pk,
        )
        notified += 1
