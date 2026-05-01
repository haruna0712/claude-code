"""DM のドメインルール (サービス層).

DB 制約では表現できないビジネス不変条件をここに集約する:

- :func:`add_member_to_room` — direct ルームは厳密に 2 名、group ルームは
  ``GROUP_MEMBER_LIMIT`` (=20) 名まで (SPEC §7.1)
- :func:`validate_message_payload` — body 空 + attachments 0 の空メッセージを弾く
  (Consumer / DRF の Serializer から呼び出す前提)

後続 Issue (P3-03 Consumer / P3-04 招待 API / P3-06 添付確定 API) はここを呼び出す。
"""

from __future__ import annotations

from django.contrib.auth.base_user import AbstractBaseUser
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from apps.dm.models import (
    DIRECT_MEMBER_LIMIT,
    GROUP_MEMBER_LIMIT,
    DMRoom,
    DMRoomMembership,
)


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
