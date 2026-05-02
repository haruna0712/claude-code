"""DM のシリアライザ (P3-03 / Issue #228).

- :class:`MessageSerializer` — WebSocket broadcast / REST レスポンス共通の表現
- :class:`MessageAttachmentSerializer` — Message に nested

Phase 4A 通知 / Phase 6 記事画像 の serializer もこのパターンを踏襲する想定。
"""

from __future__ import annotations

from rest_framework import serializers

from apps.dm.models import Message, MessageAttachment


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
