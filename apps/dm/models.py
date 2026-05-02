"""DM 機能のドメインモデル (P3-01 / Issue #226)。

ER §2.14 と Issue P3-01 に従う 6 モデル:

- :class:`DMRoom` — 1:1 (``direct``) または グループ (``group``) チャットルーム
- :class:`DMRoomMembership` — Room と User の紐付け (last_read_at を保持)
- :class:`Message` — 本文 5000 字上限、論理削除 (``deleted_at``) 対応
- :class:`MessageAttachment` — S3 直接アップロード後の添付メタデータ
- :class:`MessageReadReceipt` — 個別メッセージ既読 (Phase 3 では未使用、定義のみ)
- :class:`GroupInvitation` — グループ招待 (3 値 ``accepted`` で承諾/拒否/未応答)

設計メモ:

- ``MessageAttachment.s3_key`` は ER §2.14 の ``FileField(upload_to=...)`` を
  **意図的に外し** ``CharField`` で持つ。S3 プリサインド URL 直アップロード
  (Issue P3-06) で Django storage を経由しないため。互換のための ``file`` フィールドは
  実装しない (CharField の S3 key だけが正)。
- direct=2 / group<=20 / 空メッセージ拒否といったビジネスルールは DB 制約で
  表現できないため :mod:`apps.dm.services` のサービス層で検査する。
- ``MessageReadReceipt`` は ER §2.14 にあるため定義は実装するが、
  Phase 3 のビジネスロジックでは ``DMRoomMembership.last_read_at`` を主とし、
  個別 receipt の生成は行わない (P3-05 既読 API は room 単位で更新する)。
"""

from __future__ import annotations

from django.conf import settings
from django.db import models

# Issue P3-01 / SPEC §7.3: Markdown 本文 5000 字上限
MESSAGE_BODY_MAX_LENGTH = 5000

# SPEC §7.1: グループ最大 20 名 (services.add_member_to_room で検査)
GROUP_MEMBER_LIMIT = 20

# SPEC §7.1: 1:1 ルームの member 数 (services.add_member_to_room で検査)
DIRECT_MEMBER_LIMIT = 2


class DMRoom(models.Model):
    """1:1 または グループ DM ルーム.

    ``last_message_at`` は新着メッセージ受信時に :mod:`apps.dm.signals` または
    Consumer 層で更新される (本 Issue ではフィールド定義のみ、更新ロジックは
    P3-03 Consumer 実装で配線)。``db_index=True`` のため room 一覧の
    「最終メッセージ降順」クエリが高速。
    """

    class Kind(models.TextChoices):
        DIRECT = "direct", "1:1"
        GROUP = "group", "group"

    kind = models.CharField(
        max_length=10,
        choices=Kind.choices,
    )
    name = models.CharField(
        max_length=50,
        blank=True,
        help_text="グループ名 (kind=group のときのみ使用)",
    )
    creator = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_rooms",
        help_text="グループ作成者。退会で SET_NULL。1:1 ルームでは null。",
    )
    last_message_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="最終メッセージ送信時刻 (room 一覧ソート用)",
    )
    is_archived = models.BooleanField(
        default=False,
        help_text="運営によるアーカイブ (通常運用では未使用)",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-last_message_at", "-created_at"]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        if self.kind == self.Kind.GROUP:
            return f"DMRoom[group:{self.name or self.pk}]"
        return f"DMRoom[direct:{self.pk}]"


class DMRoomMembership(models.Model):
    """Room と User の紐付け.

    - ``last_read_at`` は P3-05 既読 API で更新する。null は「一度も既読していない」。
    - ``muted_at`` は将来の per-room ミュート用 (Phase 4B 以降の拡張余地、Phase 3 では未使用)。

    ER §2.14 は ``joined_at`` を持つが Phase 3 では ``created_at`` と完全に一致する
    (招待承諾と同じトランザクションで row を作るため)。重複を避けるため
    ``created_at`` のみとし、ER との対応は本 docstring で明示する (code-reviewer HIGH)。
    """

    room = models.ForeignKey(DMRoom, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dm_memberships",
    )
    last_read_at = models.DateTimeField(null=True, blank=True)
    muted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "user"], name="dm_unique_room_member"),
        ]
        # 「自分が参加している room 一覧」クエリ (`user=me` で order by `room.last_message_at`)
        # の前段フィルタを高速化。
        indexes = [
            models.Index(fields=["user", "room"], name="dm_membership_user_room"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"DMRoomMembership[room={self.room_id} user={self.user_id}]"


class Message(models.Model):
    """DM メッセージ.

    本 Issue では物理削除で十分 (SPEC §7.3 「自分の送信は物理削除可」)。
    ``deleted_at`` は ER §2.14 互換のため保持するが、削除フローは
    後続 Issue (Consumer 経由の delete_message) で配線する。
    """

    room = models.ForeignKey(DMRoom, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="dm_messages",
        help_text="送信者。退会で SET_NULL (発言は残るが author 表示は『退会済ユーザー』)",
    )
    body = models.CharField(
        max_length=MESSAGE_BODY_MAX_LENGTH,
        blank=True,
        help_text="Markdown 本文。空でも添付があれば送信可 (validation は services 層)",
    )
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # room 個別画面の「最新 N 件取得」「過去ページネーション」に効く index。
        indexes = [
            models.Index(fields=["room", "-created_at"], name="dm_msg_room_created"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"Message[room={self.room_id} sender={self.sender_id} pk={self.pk}]"


class MessageAttachment(models.Model):
    """S3 直接アップロード後のメタデータ.

    Issue P3-01 の指示通り ``s3_key`` は ``CharField`` で保持する
    (``FileField(upload_to=...)`` は使わない)。理由:

    - S3 プリサインド URL でフロント → S3 直 PUT する設計 (Issue P3-06)
    - Django storage を経由するとプリサインド経路と二重になり整合性が崩れる
    - 大容量バイナリで Channels イベントループを止めない

    フォーマット: ``dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>`` (バケット相対 path)
    """

    # P3-06: presign-confirm-send フローでは Confirm API が orphan attachment
    # (message=null) を作成し、send_message が attachment_ids 経由で紐付ける。
    # 紐付け前は orphan として一時的に存在 (30 分の GC 対象)。
    message = models.ForeignKey(
        Message,
        on_delete=models.CASCADE,
        related_name="attachments",
        null=True,
        blank=True,
        help_text="紐付け前は null (Confirm API 経由で作成された orphan)",
    )
    s3_key = models.CharField(
        max_length=512,
        unique=True,
        help_text="S3 オブジェクトキー (バケット相対)。dm/<room_id>/<yyyy>/<mm>/<uuid>.<ext>",
    )
    filename = models.CharField(max_length=200)
    mime_type = models.CharField(max_length=100)
    # PositiveIntegerField は Postgres バックエンドで MinValueValidator(0) を
    # 暗黙に持つので明示は不要 (python-reviewer / code-reviewer MEDIUM)。
    size = models.PositiveIntegerField(
        help_text="バイト数。SPEC §7.3 上限は service 層で検査。",
    )
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)

    # P3-06: 添付確定時の uploader (room メンバー検証 / GC で他人の orphan を消さない)。
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dm_uploaded_attachments",
        null=True,
        blank=True,
        help_text="orphan 状態で uploader を保持。message が紐付くと参照は不要だが履歴用に残す。",
    )
    room = models.ForeignKey(
        DMRoom,
        on_delete=models.CASCADE,
        related_name="attachments",
        null=True,
        blank=True,
        help_text="orphan 状態で room を保持 (IDOR 防止 + GC 用)。",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        # P3-06: orphan GC (message IS NULL AND created_at < threshold) を効かせる index。
        # 全 attachment 件数で full scan されないよう partial index で絞り込む。
        indexes = [
            models.Index(
                fields=["created_at"],
                condition=models.Q(message__isnull=True),
                name="dm_attachment_orphan_idx",
            ),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"MessageAttachment[message={self.message_id} key={self.s3_key}]"


class MessageReadReceipt(models.Model):
    """個別メッセージ既読 (Phase 3 ではビジネスロジック未使用、定義のみ).

    ER §2.14 にあるため model としては存在するが、Phase 3 では
    :class:`DMRoomMembership.last_read_at` を主とし、receipt は生成しない。
    将来 「誰が既読したか」を細かく出す要件が出たら、Consumer 経由で
    生成するアダプタを追加する想定。
    """

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="read_receipts")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dm_read_receipts",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["message", "user"], name="dm_unique_receipt"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        return f"MessageReadReceipt[message={self.message_id} user={self.user_id}]"


class GroupInvitation(models.Model):
    """グループ DM 招待.

    ``accepted`` は **3 値** (SPEC §7.2):

    - ``None`` (NULL) — 未応答
    - ``True`` — 承諾 (招待者は room の member に追加される)
    - ``False`` — 拒否

    招待者 (``inviter``) は退会で ``SET_NULL`` (招待履歴は残るが actor は不明)。
    被招待者 (``invitee``) は ``CASCADE`` (退会したら招待自体も消える)。
    """

    room = models.ForeignKey(DMRoom, on_delete=models.CASCADE, related_name="invitations")
    inviter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="dm_invites_sent",
    )
    invitee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dm_invites_received",
    )
    accepted = models.BooleanField(
        null=True,
        blank=True,
        help_text="None=未応答 / True=承諾 / False=拒否",
    )
    responded_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room", "invitee"], name="dm_unique_invite"),
        ]

    def __str__(self) -> str:  # pragma: no cover - 表示用
        state = (
            "pending" if self.accepted is None else ("accepted" if self.accepted else "declined")
        )
        return f"GroupInvitation[room={self.room_id} invitee={self.invitee_id} {state}]"
