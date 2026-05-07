"""DRF serializers for moderation (Phase 4B)."""

from __future__ import annotations

import uuid
from typing import Any

from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.moderation.models import Block, Mute, Report

User = get_user_model()


class _UserMiniSerializer(serializers.Serializer):
    """ブロック / ミュート対象の user の最小情報表示."""

    handle = serializers.CharField(source="username", read_only=True)
    display_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    def get_display_name(self, obj: Any) -> str:
        return getattr(obj, "display_name", "") or obj.username

    def get_avatar_url(self, obj: Any) -> str:
        return getattr(obj, "avatar_url", "") or ""


class BlockSerializer(serializers.ModelSerializer):
    """Block 行の出力."""

    blocker_handle = serializers.CharField(source="blocker.username", read_only=True)
    blockee_handle = serializers.CharField(source="blockee.username", read_only=True)
    blockee = _UserMiniSerializer(read_only=True)

    class Meta:
        model = Block
        fields = ["blocker_handle", "blockee_handle", "blockee", "created_at"]
        read_only_fields = fields


class MuteSerializer(serializers.ModelSerializer):
    muter_handle = serializers.CharField(source="muter.username", read_only=True)
    mutee_handle = serializers.CharField(source="mutee.username", read_only=True)
    mutee = _UserMiniSerializer(read_only=True)

    class Meta:
        model = Mute
        fields = ["muter_handle", "mutee_handle", "mutee", "created_at"]
        read_only_fields = fields


class _TargetHandleInputSerializer(serializers.Serializer):
    """Block / Mute 共通: target_handle を受け取って User に解決."""

    target_handle = serializers.CharField(max_length=30)


class ReportCreateSerializer(serializers.Serializer):
    target_type = serializers.ChoiceField(choices=Report.Target.choices)
    target_id = serializers.CharField(max_length=64)
    reason = serializers.ChoiceField(choices=Report.Reason.choices)
    note = serializers.CharField(max_length=1000, allow_blank=True, default="")

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # target 存在検証 (target_type に応じて適切な model を引く)
        target_type = attrs["target_type"]
        target_id = attrs["target_id"]
        target = _resolve_target(target_type, target_id)
        if target is None:
            raise serializers.ValidationError(
                {"target_id": "通報対象が見つかりません。"}, code="invalid_target"
            )
        # 自己通報禁止 (target が user の場合のみ判定可)
        # 比較は UUID (`User.id`) ベース。User.pk は int (pkid) なので使わない。
        request = self.context.get("request")
        viewer = getattr(request, "user", None)
        if (
            target_type == Report.Target.USER
            and viewer is not None
            and getattr(viewer, "id", None) is not None
            and str(viewer.id) == str(target_id)
        ):
            raise serializers.ValidationError(
                {"target_id": "自分自身を通報することはできません。"},
                code="self_target",
            )
        # tweet / thread_post / message / article の author が viewer の場合も拒否
        author_id = _get_target_author_id(target)
        if (
            author_id is not None
            and viewer is not None
            and author_id == getattr(viewer, "pk", None)
        ):
            raise serializers.ValidationError(
                {"target_id": "自分の投稿は通報できません。"},
                code="self_target",
            )
        return attrs


def _resolve_target(target_type: str, target_id: str) -> Any:
    """target_type / target_id から model instance を取得する (None なら 不在)."""
    if target_type == Report.Target.USER:
        # User.pk は BigAutoField (`pkid`)、UUID は `id` フィールド (apps/users/models.py)
        try:
            uid = uuid.UUID(target_id)
        except ValueError:
            return None
        return User.objects.filter(id=uid, is_active=True).first()
    if target_type == Report.Target.TWEET:
        try:
            from apps.tweets.models import Tweet
        except ImportError:
            return None
        try:
            tid = int(target_id)
        except ValueError:
            return None
        return Tweet.objects.filter(pk=tid, is_deleted=False).first()
    if target_type == Report.Target.THREAD_POST:
        try:
            from apps.boards.models import ThreadPost
        except ImportError:
            return None
        try:
            tid = int(target_id)
        except ValueError:
            return None
        return ThreadPost.objects.filter(pk=tid, is_deleted=False).first()
    if target_type == Report.Target.MESSAGE:
        try:
            from apps.dm.models import Message
        except ImportError:
            return None
        try:
            tid = int(target_id)
        except ValueError:
            return None
        return Message.objects.filter(pk=tid).first()
    if target_type == Report.Target.ARTICLE:
        # Phase 6 で実装、本 Phase は skip (常に存在しないとして扱う)
        return None
    return None


def _get_target_author_id(target: Any) -> Any:
    """通報対象 instance の author/sender pk を返す (該当なしは None)."""
    if target is None:
        return None
    for attr in ("author_id", "sender_id"):
        v = getattr(target, attr, None)
        if v is not None:
            return v
    # User target の場合は target.pk を author 扱い (自己通報チェック用)
    if hasattr(target, "username"):
        return target.pk
    return None


class ReportOutSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = ["id", "status", "created_at"]
        read_only_fields = fields
