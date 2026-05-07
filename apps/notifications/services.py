"""Notification services (#412 / Phase 4A).

`safe_notify` shim (`apps/common/blocking.py::safe_notify`) は内部で
`create_notification` を呼ぶ。signals 改変は不要 (forward-compat)。

責務:
- self-notify guard: actor == recipient の場合は no-op
- **設定 OFF skip** (#415): NotificationSetting で OFF の kind は通知作成しない
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


def is_kind_enabled_for(user: Any, kind: str) -> bool:
    """user が kind 通知を受け取る設定か (#415).

    DB 行が無ければ ``True`` を返す (= 既定 ON、opt-out 記録のみ)。
    user=None なら False (system notification の receive 不可)。
    """
    if user is None:
        return False
    from apps.notifications.models import NotificationSetting

    setting = NotificationSetting.objects.filter(user=user, kind=kind).first()
    return setting is None or setting.enabled


def create_notification(
    *,
    kind: str,
    recipient: Any,
    actor: Any | None = None,
    target_type: str = "",
    target_id: Any = None,
) -> Any | None:
    """通知を作る (dedup / self-skip / 設定 OFF skip 込み)。

    Returns:
        作成された Notification、または skip された場合 None。
    """
    from apps.notifications.models import Notification

    # self-notify guard
    if actor is not None and getattr(actor, "pk", None) == getattr(recipient, "pk", None):
        return None

    # #415: NotificationSetting で OFF なら早期 return (dedup query 走らせない)
    if not is_kind_enabled_for(recipient, kind):
        return None

    # Phase 4B (#445): Block / Mute フィルタ。
    # - recipient が actor を Block している (双方向) → notify しない
    # - recipient が actor を Mute している (一方向) → notify しない
    # actor が None (system notification) のときは skip しない。
    if actor is not None:
        from apps.common.blocking import is_blocked_relationship
        from apps.common.muting import is_muted_by

        if is_blocked_relationship(recipient, actor):
            return None
        if is_muted_by(recipient, actor):
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


# ===========================================================================
# #416 通知のグループ化
# ===========================================================================

# 集約対象 kind (like / repost / follow)。quote / reply / mention は集約しない。
GROUPING_KINDS: frozenset[str] = frozenset({"like", "repost", "follow"})

# 7 日 bucket で集約 (8 日離れた row は別 group)
GROUP_BUCKET_DAYS = 7

# 上位アバター表示数
TOP_ACTORS_PER_GROUP = 3


def _user_to_actor_dict(user: Any) -> dict[str, Any]:
    """User を actor dict に整形 (serializer と同じ shape)."""
    if user is None:
        return {}
    return {
        "id": str(getattr(user, "id", user.pk)),
        "handle": user.username,
        "display_name": getattr(user, "display_name", "") or "",
        "avatar_url": getattr(user, "avatar_url", "") or "",
    }


def _group_key(notif: Any) -> tuple:
    """7 日 bucket + 同一 (recipient, kind, target) で集約."""
    bucket = notif.created_at.toordinal() // GROUP_BUCKET_DAYS
    return (
        notif.recipient_id,
        notif.kind,
        notif.target_type,
        notif.target_id,
        bucket,
    )


def _make_single_group(n: Any) -> dict[str, Any]:
    actor_dict = _user_to_actor_dict(n.actor) if n.actor is not None else None
    return {
        "id": str(n.id),
        "kind": n.kind,
        "actors": [actor_dict] if actor_dict is not None else [],
        "actor_count": 1,
        "target_type": n.target_type,
        "target_id": n.target_id,
        "read": n.read,
        "read_at": n.read_at,
        "latest_at": n.created_at,
        "row_ids": [str(n.id)],
    }


def aggregate_notifications(notifications) -> list[dict[str, Any]]:
    """通知行を group ベースに集約する (#416).

    集約対象 kind (`GROUPING_KINDS`) のうち target を持つ row のみ集約。
    集約外 kind (quote/reply/mention など) は 1 row = 1 group。

    入力は ``-created_at`` 降順を期待 (latest_at の更新ロジックが単純化される)。
    """
    out: list[dict[str, Any]] = []
    seen: dict[tuple, dict[str, Any]] = {}

    for n in notifications:
        is_groupable = n.kind in GROUPING_KINDS and bool(n.target_type) and bool(n.target_id)
        if not is_groupable:
            out.append(_make_single_group(n))
            continue
        key = _group_key(n)
        existing = seen.get(key)
        if existing is None:
            grp = _make_single_group(n)
            seen[key] = grp
            out.append(grp)
            continue
        existing["actor_count"] += 1
        if len(existing["actors"]) < TOP_ACTORS_PER_GROUP and n.actor is not None:
            existing["actors"].append(_user_to_actor_dict(n.actor))
        # 1 つでも未読なら group=未読
        if not n.read:
            existing["read"] = False
        existing["row_ids"].append(str(n.id))
    return out
