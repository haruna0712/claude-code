"""Notification serializers (#412 / Phase 4A).

target_preview は target_type ごとに lazy lookup。N+1 を防ぐため、
viewset 側で paginated page 単位に in_bulk → context として渡す。
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.notifications.models import (
    Notification,
    NotificationKind,
    NotificationSetting,
)

TWEET_BODY_EXCERPT_LENGTH = 50


class NotificationActorSerializer(serializers.Serializer):
    """通知 actor の最小情報 (handle / display_name / avatar_url)."""

    id = serializers.UUIDField(source="pk_uuid", read_only=True)
    handle = serializers.CharField(source="username", read_only=True)
    display_name = serializers.CharField(read_only=True, allow_blank=True, default="")
    avatar_url = serializers.CharField(read_only=True, allow_blank=True, default="")


def _user_to_actor_dict(user: Any) -> dict[str, Any]:
    return {
        "id": str(getattr(user, "id", user.pk)),
        "handle": user.username,
        "display_name": getattr(user, "display_name", "") or "",
        "avatar_url": getattr(user, "avatar_url", "") or "",
    }


class NotificationSerializer(serializers.ModelSerializer):
    """通知一覧 / 個別取得用."""

    actor = serializers.SerializerMethodField()
    target_preview = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = (
            "id",
            "kind",
            "actor",
            "target_type",
            "target_id",
            "target_preview",
            "read",
            "read_at",
            "created_at",
        )
        read_only_fields = fields

    def get_actor(self, obj: Notification) -> dict[str, Any] | None:
        if obj.actor is None:
            return None
        return _user_to_actor_dict(obj.actor)

    def get_target_preview(self, obj: Notification) -> dict[str, Any] | None:
        if not obj.target_type or not obj.target_id:
            return None
        previews: dict[str, dict[str, Any]] = self.context.get("target_previews", {})
        key = f"{obj.target_type}:{obj.target_id}"
        return previews.get(key)


def serialize_notification_groups(
    groups: list[dict[str, Any]],
    target_previews: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """#416: aggregate 後の group dict 配列をレスポンス形に変換.

    後方互換のため `actor` (= actors[0]) と `created_at` (= latest_at) を併存。
    """
    out: list[dict[str, Any]] = []
    for g in groups:
        actors = g.get("actors", [])
        first_actor = actors[0] if actors else None
        target_type = g.get("target_type", "")
        target_id = g.get("target_id", "")
        preview = None
        if target_type and target_id:
            preview = target_previews.get(f"{target_type}:{target_id}")
        out.append(
            {
                "id": g["id"],
                "kind": g["kind"],
                "actor": first_actor,  # 後方互換
                "actors": actors,
                "actor_count": g["actor_count"],
                "target_type": target_type,
                "target_id": target_id,
                "target_preview": preview,
                "read": g["read"],
                "read_at": g["read_at"],
                "created_at": g["latest_at"],  # 後方互換
                "latest_at": g["latest_at"],
                "row_ids": g["row_ids"],
            }
        )
    return out


def build_target_previews(notifications: list[Notification]) -> dict[str, dict[str, Any]]:
    """N+1 回避のためページ単位で target を bulk lookup.

    Returns:
        { "tweet:<id>": {...}, "user:<uuid>": {...}, ... }
    """
    tweet_ids: list[int] = []
    user_ids: list[str] = []  # User.id (UUID) を str で扱う
    for n in notifications:
        if not n.target_type or not n.target_id:
            continue
        if n.target_type == "tweet":
            try:
                tweet_ids.append(int(n.target_id))
            except (TypeError, ValueError):
                continue
        elif n.target_type == "user":
            user_ids.append(n.target_id)

    out: dict[str, dict[str, Any]] = {}

    if tweet_ids:
        from apps.tweets.models import Tweet

        # all_objects: 削除済も含めて lookup (`is_deleted` を返したい)
        tweets = Tweet.all_objects.filter(pk__in=tweet_ids).only("pk", "body", "is_deleted")
        for t in tweets:
            body = (t.body or "")[:TWEET_BODY_EXCERPT_LENGTH]
            out[f"tweet:{t.pk}"] = {
                "type": "tweet",
                "body_excerpt": body,
                "is_deleted": bool(t.is_deleted),
            }

    if user_ids:
        from django.contrib.auth import get_user_model

        User = get_user_model()
        # User.id は UUID。target_id は str(uuid)。filter(id__in=...) で UUID 比較.
        users = User.objects.filter(id__in=user_ids).only(
            "id", "username", "display_name", "avatar_url"
        )
        for u in users:
            out[f"user:{u.id}"] = {
                "type": "user",
                "handle": u.username,
                "display_name": u.display_name or "",
                "avatar_url": u.avatar_url or "",
            }

    return out


# -------------------------------------------------------------------------
# #415 NotificationSetting
# -------------------------------------------------------------------------


class NotificationSettingItemSerializer(serializers.Serializer):
    """1 行 (kind, enabled) のレスポンス形."""

    kind = serializers.ChoiceField(choices=NotificationKind.choices)
    enabled = serializers.BooleanField()


def list_notification_settings_for(user: Any) -> list[dict[str, Any]]:
    """user の全 10 種別の設定を返す。DB 行が無い kind は ``enabled=True``.

    順序は ``NotificationKind.choices`` に従う。
    """
    rows = NotificationSetting.objects.filter(user=user).only("kind", "enabled")
    by_kind = {r.kind: r.enabled for r in rows}
    return [{"kind": k, "enabled": by_kind.get(k, True)} for k, _label in NotificationKind.choices]
