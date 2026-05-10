"""DM / 他アプリ → 通知ディスパッチ統一ブリッジ (#487, Phase 4A 着工).

`apps/dm/integrations/notifications.py` の `_dispatch_or_noop` がプロセス起動時に
**動的 import** で本モジュールの :func:`emit_notification` を resolve する。

- 本モジュールが存在しない → import 失敗 → DM 側は silent no-op (Phase 3 期待)
- 本モジュールがある (Phase 4A 以降) → emit_notification 経由で
  ``apps.notifications.services.create_notification`` を呼び DB に永続化

呼び出し側は `recipient_id`, `kind`, **payload (actor_id / room_id / message_id /
invitation_id 等) を渡す。本モジュールで kind ごとの target_type / target_id へ
マッピングする。

注意: `_resolve_emit_notification` は**プロセス起動時 1 回だけ resolve** するため、
本モジュールを後から追加した場合は **プロセス再起動が必要** (zero-downtime hot
reload では reflect されない)。stg / prod は通常 deploy = ECS rolling 起動で活性化。
"""

from __future__ import annotations

import logging
from typing import Any

from django.contrib.auth import get_user_model

from apps.notifications.services import create_notification

logger = logging.getLogger(__name__)

User = get_user_model()


# kind → (target_type, payload キー名) のマッピング。
# `apps/dm/integrations/notifications.py` が渡す payload キーと整合させる。
_TARGET_FOR_KIND: dict[str, tuple[str, str | None]] = {
    "dm_invite": ("invitation", "invitation_id"),
    "dm_message": ("message", "message_id"),
    # Phase 4A 既存の like / repost / quote / reply / mention / follow は各
    # caller (apps/reactions, apps/follows 等) が直接 create_notification を
    # 呼んでいるため、ここでマッピングは必要ない。本テーブルは「DM bridge から
    # _dispatch_or_noop 経由で来る kind」 専用。
}


def emit_notification(
    *,
    recipient_id: int | str,
    kind: str,
    actor_id: int | str | None = None,
    **payload: Any,
) -> None:
    """DM bridge / 他アプリからの通知ディスパッチ統一エントリ (#487).

    `recipient_id` / `actor_id` は user の pkid (int) を想定するが、
    フォワード互換のため UUID 文字列も受け付ける (User.objects.filter で resolve)。

    Notification 作成のロジック (self-skip / 設定 OFF skip / dedup / Block / Mute) は
    すべて `create_notification` 側に委譲する。例外は飲み込まず logger.exception で
    Sentry に送る (architect HIGH 反映、silent failure 抑制)。
    """

    target_type, payload_key = _TARGET_FOR_KIND.get(kind, ("", None))
    target_id = payload.get(payload_key) if payload_key else None

    try:
        recipient = User.objects.filter(pk=recipient_id).first()
        if recipient is None:
            logger.warning(
                "emit_notification: recipient not found",
                extra={"kind": kind, "recipient_id": recipient_id},
            )
            return
        actor = User.objects.filter(pk=actor_id).first() if actor_id is not None else None
        create_notification(
            kind=kind,
            recipient=recipient,
            actor=actor,
            target_type=target_type,
            target_id=target_id,
        )
    except Exception:  # pragma: no cover - 想定外 DB 障害
        logger.exception(
            "emit_notification dispatch failed",
            extra={"kind": kind, "recipient_id": recipient_id},
        )
