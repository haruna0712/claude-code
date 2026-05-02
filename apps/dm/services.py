"""DM のドメインルール (サービス層).

DB 制約では表現できないビジネス不変条件をここに集約する:

- :func:`add_member_to_room` — direct ルームは厳密に 2 名、group ルームは
  ``GROUP_MEMBER_LIMIT`` (=20) 名まで (SPEC §7.1)
- :func:`validate_message_payload` — body 空 + attachments 0 の空メッセージを弾く
- :func:`send_message` — Block チェック / 添付 prefix 検証 / Message + Attachments 作成 /
  ``last_message_at`` 更新 / on_commit で通知発火を 1 関数に集約 (P3-03 Consumer)

P3-03 Consumer / P3-04 招待 API / P3-06 添付確定 API はここを呼び出す。
"""

from __future__ import annotations

from pathlib import PurePosixPath

import structlog
from django.contrib.auth.base_user import AbstractBaseUser
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

# 関数を直接 import すると monkeypatch (Phase 4 移行 spec) が効かなくなるため
# module 経由で参照する (P3-15 phase-3-stub-bridges.md の caller indirection 規約)。
from apps.dm.integrations import moderation as _moderation
from apps.dm.integrations import notifications as _notifications
from apps.dm.models import (
    DIRECT_MEMBER_LIMIT,
    GROUP_MEMBER_LIMIT,
    DMRoom,
    DMRoomMembership,
    Message,
    MessageAttachment,
)

_logger = structlog.get_logger(__name__)


def add_member_to_room(room: DMRoom, user: AbstractBaseUser) -> DMRoomMembership:
    """``room`` に ``user`` を追加する.

    direct ルームは 2 名で固定、group ルームは :data:`GROUP_MEMBER_LIMIT` まで。
    超過した場合と同一 (room, user) を再追加した場合はいずれも :class:`ValidationError`。

    並行 INSERT で **異なるユーザー** が同時に member 19→20 に到達するとカウント検査を
    両方すり抜ける問題があるため、まず ``DMRoom`` の行を ``SELECT ... FOR UPDATE`` で
    ロックして per-room にシリアライズする。ロック粒度は room 1 行のみで、保持時間は
    count + insert の sub-ms なので contention は無視できる (database-reviewer HIGH 反映)。

    Raises:
        ValidationError: 上限超過 / 重複 member
    """

    limit = DIRECT_MEMBER_LIMIT if room.kind == DMRoom.Kind.DIRECT else GROUP_MEMBER_LIMIT
    kind_label = "direct" if room.kind == DMRoom.Kind.DIRECT else "group"

    with transaction.atomic():
        # per-room シリアライズ。ここで他トランザクションの追加は待ち合わせ。
        DMRoom.objects.select_for_update().get(pk=room.pk)
        current = DMRoomMembership.objects.filter(room=room).count()
        if current >= limit:
            raise ValidationError(
                f"{kind_label} room の member 上限 {limit} 名を超えるため追加できません"
                f" (現在 {current} 名)"
            )
        try:
            return DMRoomMembership.objects.create(room=room, user=user)
        except IntegrityError as exc:
            # unique(room, user) 違反 — 同一 user の再追加。
            raise ValidationError("このユーザーは既にルームに参加しています") from exc


def validate_message_payload(*, body: str | None, attachment_count: int) -> None:
    """Message 送信前の最低限のバリデーション.

    - 空文字 (空白のみを含む) かつ添付なしは「空メッセージ」として拒否
    - body が ``None`` の場合は空文字相当として扱う
    - ``attachment_count`` が負の値はプログラマエラーとして :class:`ValueError`

    Raises:
        ValueError: ``attachment_count`` が負
        ValidationError: 空メッセージの場合
    """

    if attachment_count < 0:
        raise ValueError(f"attachment_count must be non-negative, got {attachment_count!r}")
    cleaned_body = (body or "").strip()
    if not cleaned_body and attachment_count == 0:
        raise ValidationError("空のメッセージは送信できません (本文または添付のいずれかが必要)")


def _validate_attachment_keys_for_room(*, room_id: int, attachment_keys: list[dict]) -> None:
    """添付の ``s3_key`` がすべて ``dm/<room_id>/`` 配下を指していることを保証.

    フロントが S3 直アップロードで生成した key を Django に渡す設計のため、
    任意 prefix を許すと「他 room の attachment を流用する IDOR」が成立する。
    本関数は service 層の入口でこれを弾く。

    sec H-2 反映: ``../`` のような path traversal を正規化してからチェックする。
    S3 自体は ``..`` を literal として扱うが、CDN / Lambda / プリサインド URL 生成側が
    正規化する経路があると prefix bypass が成立しうるため、defense-in-depth として
    入口で弾く。
    """

    expected_prefix = f"dm/{room_id}/"
    for entry in attachment_keys:
        raw_key = entry.get("s3_key", "")
        # PurePosixPath で ``../`` / ``./`` を正規化してから prefix 検査する。
        # 絶対パス (``/abc``) は normalised が ``/abc`` のままなので prefix mismatch で弾かれる。
        normalised = str(PurePosixPath(raw_key))
        if not normalised.startswith(expected_prefix):
            raise ValidationError(
                f"attachment s3_key must start with '{expected_prefix}': got {raw_key!r}"
            )


def send_message(
    *,
    room: DMRoom,
    sender: AbstractBaseUser,
    body: str,
    attachment_keys: list[dict],
) -> Message:
    """DM メッセージを送信する (Consumer / API から呼ばれる) .

    フロー:

    1. **空メッセージ拒否** (``validate_message_payload``)
    2. **添付 s3_key prefix 検証** (room_id 配下のみ許可、IDOR 防止)
    3. **direct room の Block ガード** — 1:1 で send 側 / 受信側どちらかが Block
       していれば :class:`PermissionDenied`。group は対象外 (N:N で各ペア判定は重い、
       Phase 4B でグループ用の方針を再検討)
    4. ``transaction.atomic`` 内で:
       - ``Message.objects.create``
       - ``MessageAttachment.objects.bulk_create``
       - ``DMRoom.last_message_at`` を ``update_fields`` で更新
    5. ``transaction.on_commit`` で :func:`emit_dm_message` を発火
       (Phase 3 では no-op、Phase 4A で通知レコード生成に変わる)

    Args:
        room: 送信先 ``DMRoom``
        sender: 送信者 (room メンバー前提、メンバー検証は Consumer 側で済んでいる前提)
        body: Markdown 本文 (空でも attachments があれば OK)
        attachment_keys: ``[{"s3_key": "...", "filename": "...", ...}, ...]`` のリスト

    Returns:
        作成された ``Message`` (transaction commit 済)

    Raises:
        ValidationError: 空メッセージ / 添付 prefix 不一致
        PermissionDenied: direct room で Block 関係
    """

    # 1. 空メッセージ拒否
    validate_message_payload(body=body, attachment_count=len(attachment_keys))

    # 2. 添付 s3_key prefix 検証 (DB 書き込み前に弾く)
    _validate_attachment_keys_for_room(room_id=room.pk, attachment_keys=attachment_keys)

    now = timezone.now()
    with transaction.atomic():
        # 3. direct room の Block ガード — atomic 内に置くことで
        # Phase 4B の Block レコード INSERT との TOCTOU を回避する (security CRITICAL C-1)
        if room.kind == DMRoom.Kind.DIRECT:
            peer_membership = (
                DMRoomMembership.objects.select_related("user")
                .filter(room=room)
                .exclude(user=sender)
                .first()
            )
            if peer_membership is not None and _moderation.is_dm_blocked(
                sender, peer_membership.user
            ):
                raise PermissionDenied("relationship blocked")

        message = Message.objects.create(room=room, sender=sender, body=body or "")
        if attachment_keys:
            MessageAttachment.objects.bulk_create(
                [
                    MessageAttachment(
                        message=message,
                        s3_key=entry["s3_key"],
                        filename=entry.get("filename", ""),
                        mime_type=entry.get("mime_type", ""),
                        size=entry.get("size", 0),
                        width=entry.get("width"),
                        height=entry.get("height"),
                    )
                    for entry in attachment_keys
                ]
            )
        # last_message_at は room 一覧 ordering に効く。in-place mutation を避け
        # ``QuerySet.update`` で書き込み (immutability + concurrent safe、code MEDIUM)。
        DMRoom.objects.filter(pk=room.pk).update(last_message_at=now, updated_at=now)

        # 4. on_commit で通知発火 (Phase 4A で実装に切り替わる、Phase 3 は no-op).
        # Django の ``on_commit`` は callback 内例外を silent swallow するため、
        # Phase 4A 移行時に通知失敗が見えなくならないよう、wrap して例外をログに残す
        # (silent-failure-hunter HIGH F7 反映)。
        transaction.on_commit(lambda: _emit_dm_message_safely(message))

    return message


def _emit_dm_message_safely(message: Message) -> None:
    """on_commit callback wrapper. 通知発火の例外は server-side ログに残してから握る.

    通知失敗で Message 作成自体を巻き戻したくないので fail-open にする。ただし
    silent にしないため structlog warning に exc_info 付きで送る。
    """

    try:
        _notifications.emit_dm_message(message)
    except Exception:
        _logger.warning(
            "dm.services.on_commit.emit_failed",
            message_id=message.pk,
            room_id=message.room_id,
            exc_info=True,
        )
