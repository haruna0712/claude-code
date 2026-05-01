"""Admin registrations for the dm app (P3-01 / Issue #226).

**運用方針**: DM の本文 / 添付メタ / 招待履歴は、ユーザーのプライバシーに直結する
データである。Django admin での閲覧は **CSAM (児童ポルノ画像) 対応** または
**通報処理** など正当な運営目的に限定する。日常のデバッグ目的で開かないこと。

実装上の方針:

- すべて **read-only** (add / change / delete を admin 経由では許可しない)
- 一覧・詳細の両方で全フィールドを ``readonly_fields`` に列挙
- 大量データを admin で開いて DB 負荷をかけないよう ``list_per_page`` を控えめに
"""

from __future__ import annotations

from django.contrib import admin

from apps.dm.models import (
    DMRoom,
    DMRoomMembership,
    GroupInvitation,
    Message,
    MessageAttachment,
    MessageReadReceipt,
)


class _ReadOnlyAdminMixin:
    """add / change / delete をすべて拒否する mixin。"""

    def has_add_permission(self, request, obj=None):  # type: ignore[override]
        return False

    def has_change_permission(self, request, obj=None):  # type: ignore[override]
        # 詳細閲覧は許可するが、保存は不可。
        return request.method in {"GET", "HEAD"}

    def has_delete_permission(self, request, obj=None):  # type: ignore[override]
        return False


@admin.register(DMRoom)
class DMRoomAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    list_display = ("id", "kind", "name", "creator", "last_message_at", "is_archived")
    list_filter = ("kind", "is_archived")
    search_fields = ("name",)
    readonly_fields = (
        "id",
        "kind",
        "name",
        "creator",
        "last_message_at",
        "is_archived",
        "created_at",
        "updated_at",
    )
    list_per_page = 50


@admin.register(DMRoomMembership)
class DMRoomMembershipAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    list_display = ("id", "room", "user", "created_at", "last_read_at", "muted_at")
    raw_id_fields = ("room", "user")
    # 明示的に空。FK pop-up search 経由の username/email 漏洩を防ぐ
    # (code-reviewer HIGH)。
    search_fields = ()
    readonly_fields = (
        "id",
        "room",
        "user",
        "last_read_at",
        "muted_at",
        "created_at",
        "updated_at",
    )
    list_per_page = 50


@admin.register(Message)
class MessageAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    """Message 本文は CSAM / 通報対応のときのみ閲覧する.

    通常の運用デバッグでこの画面を開かないこと。本文表示は最小限に
    留めるため list_display には body を含めず、詳細画面でのみ参照可能。
    """

    list_display = ("id", "room", "sender", "created_at", "deleted_at")
    list_filter = ("deleted_at",)
    raw_id_fields = ("room", "sender")
    search_fields = ("id",)  # body は意図的に検索対象外
    readonly_fields = (
        "id",
        "room",
        "sender",
        "body",
        "deleted_at",
        "created_at",
        "updated_at",
    )
    list_per_page = 50


@admin.register(MessageAttachment)
class MessageAttachmentAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    list_display = (
        "id",
        "message",
        "filename",
        "mime_type",
        "size",
        "created_at",
    )
    list_filter = ("mime_type",)
    raw_id_fields = ("message",)
    search_fields = ()  # FK pop-up search 経由の漏洩を防ぐ
    readonly_fields = (
        "id",
        "message",
        "s3_key",
        "filename",
        "mime_type",
        "size",
        "width",
        "height",
        "created_at",
        "updated_at",
    )
    list_per_page = 50


@admin.register(MessageReadReceipt)
class MessageReadReceiptAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    list_display = ("id", "message", "user", "created_at")
    raw_id_fields = ("message", "user")
    search_fields = ()  # FK pop-up search 経由の漏洩を防ぐ
    readonly_fields = ("id", "message", "user", "created_at", "updated_at")
    list_per_page = 50


@admin.register(GroupInvitation)
class GroupInvitationAdmin(_ReadOnlyAdminMixin, admin.ModelAdmin):  # type: ignore[misc]
    list_display = ("id", "room", "inviter", "invitee", "accepted", "responded_at")
    list_filter = ("accepted",)
    raw_id_fields = ("room", "inviter", "invitee")
    # 明示的に空。FK pop-up search で invitee/inviter の username/email を
    # 部分一致照会されるのを防ぐ (code-reviewer HIGH)。
    search_fields = ()
    readonly_fields = (
        "id",
        "room",
        "inviter",
        "invitee",
        "accepted",
        "responded_at",
        "created_at",
        "updated_at",
    )
    list_per_page = 50
