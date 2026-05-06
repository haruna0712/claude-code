"""Notification services (#412 / Phase 4A).

`safe_notify` shim (`apps/common/blocking.py::safe_notify`) は内部で
`create_notification` を呼ぶ。signals 改変は不要 (forward-compat)。

責務:
- self-notify guard: actor == recipient の場合は no-op
- dedup window: 24h 以内の同一 (recipient, actor, kind, target_type, target_id)
  は skip (連投 like / unlike loop の noise を抑える、X 流)
- target_id stringify: 呼び出し側が int / UUID / str を渡しても CharField に
  統一して保存
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from django.utils import timezone

logger = logging.getLogger(__name__)

DEDUP_WINDOW = timedelta(hours=24)


def create_notification(
    *,
    kind: str,
    recipient: Any,
    actor: Any | None = None,
    target_type: str = "",
    target_id: Any = None,
) -> Any | None:
    """通知を作る (dedup / self-skip 込み)。

    Returns:
        作成された Notification、または skip された場合 None。
    """
    from apps.notifications.models import Notification

    # self-notify guard
    if actor is not None and getattr(actor, "pk", None) == getattr(recipient, "pk", None):
        return None

    # target_id stringify
    target_id_str = "" if target_id is None else str(target_id)

    # dedup 24h 窓 check
    # actor=None は Django ORM が IS NULL に正しく変換する (system notification 用)
    cutoff = timezone.now() - DEDUP_WINDOW
    exists = Notification.objects.filter(
        recipient=recipient,
        actor=actor,
        kind=kind,
        target_type=target_type,
        target_id=target_id_str,
        created_at__gte=cutoff,
    ).exists()
    if exists:
        return None

    try:
        return Notification.objects.create(
            kind=kind,
            recipient=recipient,
            actor=actor,
            target_type=target_type,
            target_id=target_id_str,
        )
    except Exception:  # pragma: no cover - DB 障害は Sentry に流す
        # 通知失敗は primary action (tweet/follow create) を阻まない方針。
        # `on_commit` 内で raise すると Django は print して swallow するので
        # 明示的に logger.exception で Sentry に送る。
        logger.exception(
            "create_notification failed",
            extra={
                "kind": kind,
                "recipient_pk": getattr(recipient, "pk", None),
                "actor_pk": getattr(actor, "pk", None),
                "target_type": target_type,
                "target_id": target_id_str,
            },
        )
        return None
