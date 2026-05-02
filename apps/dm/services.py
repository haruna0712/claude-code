"""DM のドメインルール (サービス層).

DB 制約では表現できないビジネス不変条件をここに集約する:

- :func:`add_member_to_room` — direct ルームは厳密に 2 名、group ルームは
  ``GROUP_MEMBER_LIMIT`` (=20) 名まで (SPEC §7.1)
- :func:`validate_message_payload` — body 空 + attachments 0 の空メッセージを弾く
- :func:`send_message` — Block チェック / 添付 prefix 検証 / Message + Attachments 作成 /
  ``last_message_at`` 更新 / on_commit で通知発火を 1 関数に集約 (P3-03 Consumer)
- :func:`get_or_create_direct_room` / :func:`create_group_room` — room 作成 (P3-04 API)
- :func:`invite_user_to_room` — 招待作成 (creator 限定 / 重複検査 / 通知発火、P3-04)
- :func:`accept_invitation` / :func:`decline_invitation` — 招待応答 (P3-04)
- :func:`leave_room` — 退室 + creator 移譲 (group のみ、P3-04)

P3-03 Consumer / P3-04 招待 API / P3-06 添付確定 API はここを呼び出す。
"""

from __future__ import annotations

from pathlib import PurePosixPath

import structlog
from django.contrib.auth import get_user_model
from django.contrib.auth.base_user import AbstractBaseUser
from django.core.exceptions import (
    ObjectDoesNotExist,
    PermissionDenied,
    ValidationError,
)
from django.db import IntegrityError, connection, transaction
from django.db.models import Count, Q
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
    GroupInvitation,
    Message,
    MessageAttachment,
)

_logger = structlog.get_logger(__name__)

# Module-level 解決 (review HIGH 反映、in-function 呼び出しを排除).
User = get_user_model()


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


def _emit_dm_invite_safely(invitation: GroupInvitation) -> None:
    """招待作成 on_commit callback. 失敗は warning ログ + fail-open."""
    try:
        _notifications.emit_dm_invite(invitation)
    except Exception:
        _logger.warning(
            "dm.services.on_commit.invite_emit_failed",
            invitation_id=invitation.pk,
            room_id=invitation.room_id,
            exc_info=True,
        )


# ----------------------------------------------------------------------------
# Room 作成 (P3-04 / Issue #229)
# ----------------------------------------------------------------------------


def get_or_create_direct_room(
    user_a: AbstractBaseUser, user_b: AbstractBaseUser
) -> tuple[DMRoom, bool]:
    """1:1 (direct) room を取得 or 新規作成 (idempotent).

    SPEC §7: 同じ 2 人で direct room を再作成しようとしたら既存の room を返す
    (UI から重複作成しても同じ DM が開く)。

    自分自身との direct room は禁止。

    Returns:
        ``(room, created)`` — created は新規作成のとき ``True``。
    """

    if user_a.pk == user_b.pk:
        raise ValidationError("自分自身との DM は作成できません")

    # Block 関係なら作成自体を弾く (Phase 4B 実装後に効く、Phase 3 は False)
    if _moderation.is_dm_blocked(user_a, user_b):
        raise PermissionDenied("relationship blocked")

    # review HIGH 反映: TOCTOU race (concurrent で同じ pair の direct room が 2 つ
    # できる) を防ぐため PostgreSQL advisory lock を使う。``Count`` annotation は
    # ``GROUP BY`` を含むため ``select_for_update`` と併用できないので、user pair から
    # 決定的に導出した int 64bit キーで ``pg_advisory_xact_lock`` を取る。
    pair = sorted([int(user_a.pk), int(user_b.pk)])
    # 2 つの user_id を組み合わせた 63bit hash (signed bigint)。
    lock_key = (pair[0] << 31) ^ pair[1]
    # 64bit に詰めて signed range [-2^63, 2^63-1] に収める
    lock_key = ((lock_key + (1 << 63)) % (1 << 64)) - (1 << 63)

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [lock_key])

        existing = (
            DMRoom.objects.filter(kind=DMRoom.Kind.DIRECT)
            .annotate(
                both=Count(
                    "memberships",
                    filter=Q(memberships__user__in=[user_a, user_b]),
                    distinct=True,
                )
            )
            .filter(both=2)
            .first()
        )
        if existing is not None:
            return existing, False
        room = DMRoom.objects.create(kind=DMRoom.Kind.DIRECT)
        DMRoomMembership.objects.create(room=room, user=user_a)
        DMRoomMembership.objects.create(room=room, user=user_b)
    return room, True


def create_group_room(
    *,
    creator: AbstractBaseUser,
    name: str,
    invitee_handles: list[str] | None = None,
) -> DMRoom:
    """グループ room を作成し、creator を membership に入れて invitees を招待.

    SPEC §7.1 / §7.2: グループ作成者が member として確定、それ以外は招待 (承諾で
    member になる)。``invitee_handles`` は ``@handle`` 文字列のリスト。

    20 名上限は ``add_member_to_room`` で creator 1 名追加時にチェック、招待は
    後段で :func:`invite_user_to_room` が個別に enforce する。
    """

    cleaned_name = (name or "").strip()
    if not cleaned_name:
        raise ValidationError("group name は必須です")
    if len(cleaned_name) > 50:
        raise ValidationError("group name は 50 字以内です")

    handles = [h.strip() for h in (invitee_handles or []) if h.strip()]

    invitees: list[AbstractBaseUser] = []
    for handle in handles:
        try:
            invitees.append(User.objects.get(username=handle))
        except User.DoesNotExist as exc:
            raise ValidationError(f"@{handle} が見つかりません") from exc

    with transaction.atomic():
        room = DMRoom.objects.create(kind=DMRoom.Kind.GROUP, name=cleaned_name, creator=creator)
        add_member_to_room(room, creator)
        for invitee in invitees:
            invite_user_to_room(room=room, inviter=creator, invitee=invitee)
    return room


# ----------------------------------------------------------------------------
# 招待 (P3-04 / Issue #229)
# ----------------------------------------------------------------------------


def invite_user_to_room(
    *,
    room: DMRoom,
    inviter: AbstractBaseUser,
    invitee: AbstractBaseUser,
) -> GroupInvitation:
    """グループ room に ``invitee`` を招待する.

    ルール (SPEC §7.2 / §A13):

    - room は ``kind=group`` のみ (direct への招待は不可、ValidationError)
    - inviter は room の creator のみ (それ以外は PermissionDenied)
    - invitee 自身が既に membership を持っているなら ValidationError (409 相当)
    - pending な招待 (accepted=None) が既にあれば **その既存 invitation を返す** (idempotent)
    - 拒否済み (accepted=False) の旧 invitation がある場合は新 invitation を作る
      (再招待は spam を招かない、A13)
    - 現 membership + pending 招待数が 20 名超なら ValidationError
    - Block 関係 (Phase 4B 以降) なら PermissionDenied
    """

    if room.kind != DMRoom.Kind.GROUP:
        raise ValidationError("direct room には招待できません")
    if room.creator_id != inviter.pk:
        raise PermissionDenied("招待は room creator のみが行えます")
    if inviter.pk == invitee.pk:
        raise ValidationError("自分自身を招待することはできません")
    if _moderation.is_dm_blocked(inviter, invitee):
        raise PermissionDenied("relationship blocked")

    with transaction.atomic():
        # review HIGH 反映: 20-cap race を防ぐため room を SELECT FOR UPDATE で
        # シリアライズする (add_member_to_room と同じパターン)。
        DMRoom.objects.select_for_update().get(pk=room.pk)

        # 既に member なら 409 相当
        if DMRoomMembership.objects.filter(room=room, user=invitee).exists():
            raise ValidationError("このユーザーは既にメンバーです")

        # pending を idempotent に再利用
        pending = GroupInvitation.objects.filter(
            room=room, invitee=invitee, accepted__isnull=True
        ).first()
        if pending is not None:
            return pending

        # 20 名上限: 現 member + pending invitation
        member_count = DMRoomMembership.objects.filter(room=room).count()
        pending_count = GroupInvitation.objects.filter(room=room, accepted__isnull=True).count()
        if member_count + pending_count >= GROUP_MEMBER_LIMIT:
            raise ValidationError(
                f"member + 招待中の人数が上限 {GROUP_MEMBER_LIMIT} 名に達しています"
            )

        # 拒否済みがあるときは unique(room, invitee) 制約に当たるので、
        # 古い拒否レコードを物理削除してから新規作成する (再招待を許容するため、A13)。
        GroupInvitation.objects.filter(room=room, invitee=invitee, accepted=False).delete()

        invitation = GroupInvitation.objects.create(room=room, inviter=inviter, invitee=invitee)
        transaction.on_commit(lambda: _emit_dm_invite_safely(invitation))
    return invitation


def accept_invitation(*, invitation: GroupInvitation, user: AbstractBaseUser) -> DMRoomMembership:
    """招待を承諾する. invitee 本人のみ可、idempotent ではなく state guard で 1 回限り."""

    if invitation.invitee_id != user.pk:
        raise PermissionDenied("自分宛ての招待のみ操作できます")
    if invitation.accepted is not None:
        raise ValidationError("この招待は既に応答済みです")

    with transaction.atomic():
        # 重複登録は add_member_to_room の unique 制約で IntegrityError → ValidationError
        membership = add_member_to_room(invitation.room, user)
        invitation.accepted = True
        invitation.responded_at = timezone.now()
        invitation.save(update_fields=["accepted", "responded_at", "updated_at"])
    return membership


def decline_invitation(*, invitation: GroupInvitation, user: AbstractBaseUser) -> GroupInvitation:
    """招待を拒否する. invitee 本人のみ可。SPEC §A13: 拒否は inviter に通知しない."""

    if invitation.invitee_id != user.pk:
        raise PermissionDenied("自分宛ての招待のみ操作できます")
    if invitation.accepted is not None:
        raise ValidationError("この招待は既に応答済みです")

    # review MEDIUM: accept_invitation と整合させて transaction.atomic で囲む
    with transaction.atomic():
        invitation.accepted = False
        invitation.responded_at = timezone.now()
        invitation.save(update_fields=["accepted", "responded_at", "updated_at"])
    return invitation


# ----------------------------------------------------------------------------
# 退室 (P3-04 / Issue #229)
# ----------------------------------------------------------------------------


def leave_room(*, room: DMRoom, user: AbstractBaseUser) -> None:
    """``user`` が ``room`` から退室する.

    - direct room の退室は不可 (archive のみ、UI で非表示にする運用)
    - creator が退室する場合: 残メンバーの最古 (created_at) から新 creator を選出。
      残メンバーが居なければ room 自体を archive する (``is_archived=True``)
    """

    if room.kind == DMRoom.Kind.DIRECT:
        raise ValidationError("1:1 room は退室できません (archive のみ)")

    with transaction.atomic():
        try:
            membership = DMRoomMembership.objects.get(room=room, user=user)
        except ObjectDoesNotExist as exc:
            raise ValidationError("このルームのメンバーではありません") from exc
        membership.delete()

        # creator 移譲
        if room.creator_id == user.pk:
            successor = (
                DMRoomMembership.objects.filter(room=room)
                .order_by("created_at", "pk")  # 最古の membership から
                .first()
            )
            if successor is None:
                DMRoom.objects.filter(pk=room.pk).update(creator=None, is_archived=True)
            else:
                DMRoom.objects.filter(pk=room.pk).update(creator=successor.user)
