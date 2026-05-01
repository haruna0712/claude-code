"""DM → 通知 (Phase 4A) のブリッジ (P3-15 / Issue #240).

Phase 3 では ``apps.notifications`` がまだ通知ディスパッチ実装を持たないため、
本モジュールは **no-op** として動作する。Phase 4A の ``apps.notifications`` 完成時に
``apps.notifications.signals.emit_notification`` を実装すれば、本モジュールは
**自動で dispatch 経路に切り替わる** (caller の DM Consumer / 招待 API は無変更)。

Phase 4A 側で実装すべきシグネチャ::

    def emit_notification(*, recipient_id: int, kind: str, **payload) -> None:
        ...

呼び出し点 (Phase 3 で正しい場所に配置済の予定 — 詳細は phase-3-stub-bridges.md):

- :mod:`apps.dm.consumers` の ``send_message`` 直後 → :func:`emit_dm_message`
- 招待 API (P3-04 で実装予定) の accept フロー直後 → :func:`emit_dm_invite`

Phase 4A での差し替え方法:

1. ``apps.notifications.signals`` に上記シグネチャの関数を実装する
2. Django 起動時 1 回だけ動的 import で resolve するため、**プロセス再起動が必要**
   (zero-downtime hot reload では reflect されない、運用で許容)
3. payload schema (``recipient_id``, ``actor_id``, ``room_id``, ``message_id`` /
   ``invitation_id``) を ``Notification`` モデルの ``target_type`` / ``target_id``
   にマッピングする責務は emit_notification 側にある (本モジュールは丸投げ)
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from apps.dm.models import GroupInvitation, Message

_logger = structlog.get_logger(__name__)


# code-reviewer HIGH 反映: 毎回 ImportError を踏むと Phase 3 のホットパス
# (高頻度 send_message) で stat/import の無駄が出る。プロセス起動時に 1 回だけ
# resolve して cache する。Phase 4A デプロイ時は **プロセス再起動が必要** (運用許容)。
_emit_notification_resolved: bool = False
_emit_notification_impl: Callable[..., None] | None = None


def _resolve_emit_notification() -> Callable[..., None] | None:
    global _emit_notification_resolved, _emit_notification_impl

    if _emit_notification_resolved:
        return _emit_notification_impl

    try:
        from apps.notifications.signals import emit_notification  # type: ignore[attr-defined]

        _emit_notification_impl = emit_notification
    except ImportError:
        # Phase 3 では期待される挙動 (Phase 4A 未実装)。起動時 1 回のみログる。
        _emit_notification_impl = None
        _logger.info("dm.notifications.stub_active")
    _emit_notification_resolved = True
    return _emit_notification_impl


def _dispatch_or_noop(kind: str, recipient_id: int | str, **payload: Any) -> None:
    """``apps.notifications`` が未実装なら静かに no-op 動作.

    Phase 4A 着手時、``apps.notifications.signals.emit_notification`` を実装すれば
    自動で dispatch 経路に切り替わる。コール側 (DM Consumer / 招待 API) は変更不要。

    note: Phase 4A 実装が **シグネチャを誤った場合** (例: ``recipient_id`` を
    ``recipient`` に rename) 呼び出しは ``TypeError`` を投げる。本モジュールは
    それを **意図的に捕捉しない** ことで silent failure を防ぐ — Phase 4A デプロイの
    smoke test で必ず検出される設計 (architect HIGH 反映)。
    """

    impl = _resolve_emit_notification()
    if impl is None:
        return  # Phase 3 期待動作 — 何もしない
    impl(recipient_id=recipient_id, kind=kind, **payload)


def emit_dm_message(message: Message) -> None:
    """新着 DM 1 件あたり、room 内の他メンバー全員に ``dm_message`` 通知を送る.

    Phase 3 は no-op (アプリ内バナー / 未読数表示は WebSocket の broadcast で十分)。
    Phase 4A で「アプリを開いていない時の通知ベル赤バッジ」用に通知レコードを作る。
    """

    if message.sender_id is None:
        return  # 退会済みユーザーの message — 通知対象不在

    for member in message.room.memberships.exclude(user_id=message.sender_id):
        _dispatch_or_noop(
            "dm_message",
            recipient_id=member.user_id,
            actor_id=message.sender_id,
            room_id=message.room_id,
            message_id=message.pk,
        )


def emit_dm_invite(invitation: GroupInvitation) -> None:
    """グループ招待発生時、被招待者に ``dm_invite`` 通知を送る.

    Phase 3 は no-op。Phase 4A で被招待者の通知一覧 + ベルバッジに反映する。
    """

    if invitation.invitee_id is None:
        return

    _dispatch_or_noop(
        "dm_invite",
        recipient_id=invitation.invitee_id,
        actor_id=invitation.inviter_id,
        room_id=invitation.room_id,
        invitation_id=invitation.pk,
    )
