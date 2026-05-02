"""DM のシリアライザ (P3-03 / Issue #228, P3-04 / Issue #229).

- :class:`MessageSerializer` / :class:`MessageAttachmentSerializer` — Message 系
- :class:`DMRoomSerializer` / :class:`DMRoomMembershipSerializer` — Room 一覧 / 詳細
- :class:`GroupInvitationSerializer` — グループ招待
- :class:`CreateDirectRoomInputSerializer` / :class:`CreateGroupRoomInputSerializer`
  / :class:`CreateInvitationInputSerializer` — 入力バリデータ

Phase 4A 通知 / Phase 6 記事画像 の serializer もこのパターンを踏襲する想定。
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.dm.models import (
    DMRoom,
    DMRoomMembership,
    GroupInvitation,
    Message,
    MessageAttachment,
)

User = get_user_model()


class MessageAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessageAttachment
        fields = (
            "id",
            "s3_key",
            "filename",
            "mime_type",
            "size",
            "width",
            "height",
        )
        read_only_fields = fields


class MessageSerializer(serializers.ModelSerializer):
    """Consumer broadcast / REST レスポンス両方で使う Message 表現."""

    attachments = MessageAttachmentSerializer(many=True, read_only=True)
    sender_id = serializers.IntegerField(source="sender.pk", allow_null=True)
    body = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = (
            "id",
            "room_id",
            "sender_id",
            "body",
            "attachments",
            "created_at",
            "updated_at",
            "deleted_at",
        )
        read_only_fields = fields

    def get_body(self, obj: Message) -> str:
        """soft-deleted な message の本文は空文字に置換 (security M-4 反映).

        Phase 3 では Message を見せる REST API は無いため実害は無いが、Phase 4 以降の
        room/messages 一覧 API が同じシリアライザを使う前提で、漏洩経路を塞いでおく。
        """
        if obj.deleted_at is not None:
            return ""
        return obj.body


# ----------------------------------------------------------------------------
# Room / Membership / Invitation (P3-04)
# ----------------------------------------------------------------------------


class DMRoomMembershipSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.pk")
    handle = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = DMRoomMembership
        # P3-01 review で `joined_at` は `created_at` に統合済 (重複排除)。
        fields = ("id", "user_id", "handle", "created_at", "last_read_at", "muted_at")
        read_only_fields = fields


class DMRoomSerializer(serializers.ModelSerializer):
    """Room 一覧 / 詳細用.

    ``unread_count`` は room 一覧 API が ``annotate_rooms_with_unread_count`` で
    annotate した値を inline で返す。annotate されていない場合 (room 詳細など) は
    ``None`` (P3-05 / Issue #230)。
    """

    creator_id = serializers.IntegerField(source="creator.pk", allow_null=True)
    memberships = DMRoomMembershipSerializer(many=True, read_only=True)
    unread_count = serializers.SerializerMethodField()

    class Meta:
        model = DMRoom
        fields = (
            "id",
            "kind",
            "name",
            "creator_id",
            "memberships",
            "unread_count",
            "last_message_at",
            "is_archived",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields

    def get_unread_count(self, obj: DMRoom) -> int | None:
        """``annotate_rooms_with_unread_count`` で付けた annotation を返す.

        annotate されていない場合 (room 詳細など) は ``None`` を返し、フロント側で
        必要なら別 endpoint から取得させる。
        """
        return getattr(obj, "unread_count", None)


class MarkRoomReadInputSerializer(serializers.Serializer):
    """``POST /rooms/<id>/read/`` の入力."""

    message_id = serializers.IntegerField(min_value=1)


class GroupInvitationSerializer(serializers.ModelSerializer):
    inviter_id = serializers.IntegerField(source="inviter.pk", allow_null=True)
    invitee_id = serializers.IntegerField(source="invitee.pk")
    inviter_handle = serializers.CharField(source="inviter.username", read_only=True, default=None)
    invitee_handle = serializers.CharField(source="invitee.username", read_only=True)

    class Meta:
        model = GroupInvitation
        fields = (
            "id",
            "room_id",
            "inviter_id",
            "inviter_handle",
            "invitee_id",
            "invitee_handle",
            "accepted",
            "responded_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields


# ----------------------------------------------------------------------------
# 入力 serializers (REST POST body)
# ----------------------------------------------------------------------------


class CreateDirectRoomInputSerializer(serializers.Serializer):
    """``POST /rooms/`` の direct 用入力."""

    member_handle = serializers.CharField(min_length=3, max_length=30)


class CreateGroupRoomInputSerializer(serializers.Serializer):
    """``POST /rooms/`` の group 用入力."""

    name = serializers.CharField(min_length=1, max_length=50)
    # 上限は GROUP_MEMBER_LIMIT - 1 (creator 含む 20 名) — review MEDIUM M-3 反映:
    # 上限なしだと CPU/Redis amplification の DoS ベクター。
    invitee_handles = serializers.ListField(
        child=serializers.CharField(min_length=3, max_length=30),
        allow_empty=True,
        required=False,
        default=list,
        max_length=19,
    )


class CreateInvitationInputSerializer(serializers.Serializer):
    invitee_handle = serializers.CharField(min_length=3, max_length=30)
