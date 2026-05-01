"""Phase 4 移行用ブリッジスタブのテスト (P3-15 / Issue #240).

Phase 3 では本モジュールは no-op / 常に False を返すスタブとして動作する。本テストは
Phase 4 着手時にも生き続ける性質を確認する:

- :mod:`apps.dm.integrations.notifications` の no-op がエラーを投げない
- :mod:`apps.dm.integrations.moderation` の常時 ``False`` 動作
- 各関数のシグネチャ (Phase 4 で実装に差し替えても callers は無変更で済む)
- monkey patch 経由で Phase 4 動作 (Block 検出 / 通知 dispatch) を擬似的に再現可能
- Phase 4A の signature mismatch は **silent fail せず TypeError が伝播** する
  (運用安全装置)
"""

from __future__ import annotations

import sys
import types

import pytest

from apps.dm.integrations import moderation, notifications
from apps.dm.models import DMRoom
from apps.dm.tests._factories import make_message, make_room, make_user


@pytest.fixture
def reset_emit_notification_cache():
    """``_resolve_emit_notification`` の起動時 1 回キャッシュを各テストで初期化.

    notifications モジュールは ``_emit_notification_resolved`` / ``_emit_notification_impl``
    を module-global で持つため、別テストで monkeypatch した結果が次のテストに
    染み出さないよう、毎回 reset する。
    """

    notifications._emit_notification_resolved = False
    notifications._emit_notification_impl = None
    yield
    notifications._emit_notification_resolved = False
    notifications._emit_notification_impl = None


class ModerationStubTests:
    """is_dm_blocked / is_dm_muted は Phase 3 では常に False."""

    def test_is_dm_blocked_returns_false_for_distinct_users(self) -> None:
        a = make_user()
        b = make_user()
        assert moderation.is_dm_blocked(a, b) is False

    def test_is_dm_blocked_returns_false_for_same_user(self) -> None:
        a = make_user()
        assert moderation.is_dm_blocked(a, a) is False

    def test_is_dm_muted_returns_false(self) -> None:
        a = make_user()
        b = make_user()
        assert moderation.is_dm_muted(a, b) is False


@pytest.mark.django_db
class TestModerationStubs(ModerationStubTests):
    """db アクセスが必要な ModerationStubTests を pytest-django で実行する wrapper."""


def _check_block_via_module_attr(user_a, user_b) -> bool:
    """テスト用の薄い caller — `moderation.is_dm_blocked` を **module attr 経由** で呼ぶ.

    Consumer が ``from apps.dm.integrations import moderation`` (module import) で
    ``moderation.is_dm_blocked(a, b)`` と呼び出す形を想定する。
    monkeypatch.setattr で module 属性を差し替えれば、本 helper も差し替え後の
    関数を呼ぶ — caller-level indirection が通っていることの確認 (code HIGH 反映)。
    """

    return moderation.is_dm_blocked(user_a, user_b)


@pytest.mark.django_db
class TestModerationCallerIndirection:
    """Phase 4B 移行時、callers が ``moderation.is_dm_blocked`` を module attr 経由で
    呼んでいる前提で monkeypatch が caller にも反映されることを確認する."""

    def test_monkeypatch_affects_module_attr_caller(self, monkeypatch) -> None:
        a = make_user()
        b = make_user()

        # 既定 (スタブ) 動作: False
        assert _check_block_via_module_attr(a, b) is False

        def _block_everything(user_a, user_b):
            return True

        monkeypatch.setattr(moderation, "is_dm_blocked", _block_everything)

        # caller (`_check_block_via_module_attr`) は moderation.is_dm_blocked を
        # 経由しているため、patch 後は True を返す。これが "caller indirection" の証拠。
        assert _check_block_via_module_attr(a, b) is True


@pytest.mark.django_db
class TestNotificationsStubs:
    """no-op stub が呼ばれてもエラーにならない."""

    def test_emit_dm_message_is_noop_without_notifications_app(
        self, reset_emit_notification_cache
    ) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        sender = make_user()
        member_a = make_user()
        member_b = make_user()
        from apps.dm.models import DMRoomMembership

        DMRoomMembership.objects.create(room=room, user=sender)
        DMRoomMembership.objects.create(room=room, user=member_a)
        DMRoomMembership.objects.create(room=room, user=member_b)

        message = make_message(room, sender=sender)

        # 例外を投げないこと (Phase 4A 未実装下では何もしないだけ)
        notifications.emit_dm_message(message)

    def test_emit_dm_message_skips_when_sender_deleted(self, reset_emit_notification_cache) -> None:
        """sender が SET_NULL で None になっている message は通知対象外."""
        room = make_room()
        message = make_message(room)
        message.sender = None
        message.save()

        notifications.emit_dm_message(message)  # 例外なし

    def test_emit_dm_invite_is_noop(self, reset_emit_notification_cache) -> None:
        from apps.dm.models import GroupInvitation

        room = make_room(kind=DMRoom.Kind.GROUP)
        inviter = make_user()
        invitee = make_user()
        invitation = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)

        notifications.emit_dm_invite(invitation)  # 例外なし

    def test_emit_dm_invite_skips_when_invitee_id_is_none(
        self, reset_emit_notification_cache
    ) -> None:
        """invitee_id が None なら早期 return (CASCADE 削除との理論的整合).

        前バージョンは ``invitation.invitee = None`` のみで ``invitee_id`` が
        descriptor 経由で sync されないため guard branch を通っていなかった
        (code MEDIUM 反映)。今回は ``invitee_id`` を直接 None に置く。
        """
        from apps.dm.models import GroupInvitation

        room = make_room(kind=DMRoom.Kind.GROUP)
        inviter = make_user()
        invitee = make_user()
        invitation = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
        invitation.invitee_id = None  # FK descriptor をバイパスして直接 None

        notifications.emit_dm_invite(invitation)  # 早期 return で例外なし


@pytest.mark.django_db
class TestNotificationsMonkeyPatchable:
    """Phase 4A 移行時、emit_notification を import できるようになると自動で dispatch."""

    def test_monkeypatch_emit_notification_is_called(
        self, monkeypatch, reset_emit_notification_cache
    ) -> None:
        room = make_room(kind=DMRoom.Kind.GROUP)
        sender = make_user()
        recipient = make_user()
        from apps.dm.models import DMRoomMembership

        DMRoomMembership.objects.create(room=room, user=sender)
        DMRoomMembership.objects.create(room=room, user=recipient)
        message = make_message(room, sender=sender)

        captured: list[dict] = []

        def _spy(*, recipient_id, kind, **payload):
            """Phase 4A の実シグネチャを mirror した spy."""
            captured.append({"recipient_id": recipient_id, "kind": kind, **payload})

        # Phase 4A の実装エントリポイントを擬似的に注入
        # (apps.notifications.signals は本 PR では未実装のため動的に生やす)
        fake_signals = types.ModuleType("apps.notifications.signals")
        fake_signals.emit_notification = _spy  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "apps.notifications.signals", fake_signals)

        notifications.emit_dm_message(message)

        # sender 以外の room member 1 名 (= recipient) に dispatch されている
        assert len(captured) == 1
        call = captured[0]
        assert call["kind"] == "dm_message"
        assert call["recipient_id"] == recipient.pk
        assert call["actor_id"] == sender.pk
        assert call["room_id"] == room.pk
        assert call["message_id"] == message.pk

    def test_signature_mismatch_propagates_typeerror(
        self, monkeypatch, reset_emit_notification_cache
    ) -> None:
        """Phase 4A 実装が誤って ``recipient`` (旧名) を期待した場合、
        ``TypeError`` が **silently 飲み込まれずに伝播** する.

        これは Phase 4A デプロイ smoke test で signature mismatch を即座に検知する
        ための「安全装置」(architect HIGH 反映)。本テストが失敗するようになったら
        ``_dispatch_or_noop`` の except 節が広すぎる。
        """
        room = make_room(kind=DMRoom.Kind.GROUP)
        sender = make_user()
        recipient = make_user()
        from apps.dm.models import DMRoomMembership

        DMRoomMembership.objects.create(room=room, user=sender)
        DMRoomMembership.objects.create(room=room, user=recipient)
        message = make_message(room, sender=sender)

        # 誤シグネチャ (recipient 引数だけ受け取る)
        def _wrong_signature(*, recipient, kind):
            pass  # pragma: no cover - 呼ばれる前に TypeError

        fake_signals = types.ModuleType("apps.notifications.signals")
        fake_signals.emit_notification = _wrong_signature  # type: ignore[attr-defined]
        monkeypatch.setitem(sys.modules, "apps.notifications.signals", fake_signals)

        with pytest.raises(TypeError):
            notifications.emit_dm_message(message)
