"""Notification views (#412 / Phase 4A).

Endpoints (SPEC §8 / docs/specs/notifications-spec.md §6):
- GET    /api/v1/notifications/                     一覧 (cursor pagination, ?unread_only=)
- GET    /api/v1/notifications/unread-count/        未読件数
- POST   /api/v1/notifications/<uuid:pk>/read/      個別既読化
- POST   /api/v1/notifications/read-all/            一括既読化
- GET    /api/v1/notifications/settings/            設定一覧 (#415)
- PATCH  /api/v1/notifications/settings/            設定 upsert (#415)
"""

from __future__ import annotations

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers as rf_serializers
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notifications.models import Notification, NotificationKind, NotificationSetting
from apps.notifications.serializers import (
    NotificationSerializer,
    build_target_previews,
    list_notification_settings_for,
)


class NotificationCursorPagination(CursorPagination):
    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"
    max_page_size = 50


class NotificationListView(ListAPIView):
    """GET /api/v1/notifications/ — 自分宛通知の一覧."""

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationSerializer
    pagination_class = NotificationCursorPagination

    def get_queryset(self) -> QuerySet[Notification]:  # type: ignore[type-arg]
        qs = (
            Notification.objects.filter(recipient=self.request.user)
            .select_related("actor")
            .order_by("-created_at")
        )
        if self.request.query_params.get("unread_only") in ("true", "1"):
            qs = qs.filter(read=False)
        return qs

    def list(self, request: Request, *args, **kwargs):  # type: ignore[no-untyped-def]
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        if page is None:
            previews = build_target_previews(list(queryset))
            serializer = self.get_serializer(
                queryset,
                many=True,
                context={"target_previews": previews, "request": request},
            )
            return Response(serializer.data)
        previews = build_target_previews(list(page))
        serializer = self.get_serializer(
            page,
            many=True,
            context={"target_previews": previews, "request": request},
        )
        return self.get_paginated_response(serializer.data)


class NotificationUnreadCountView(APIView):
    """GET /api/v1/notifications/unread-count/ — `{count: N}`."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        count = Notification.objects.filter(recipient=request.user, read=False).count()
        return Response({"count": count})


class NotificationReadView(APIView):
    """POST /api/v1/notifications/<pk>/read/ — 個別既読化."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request, pk: str) -> Response:
        notif = get_object_or_404(Notification, pk=pk, recipient=request.user)
        if not notif.read:
            notif.read = True
            notif.read_at = timezone.now()
            notif.save(update_fields=["read", "read_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationReadAllView(APIView):
    """POST /api/v1/notifications/read-all/ — 一括既読化."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        now = timezone.now()
        Notification.objects.filter(recipient=request.user, read=False).update(
            read=True, read_at=now, updated_at=now
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


# -------------------------------------------------------------------------
# #415 NotificationSetting endpoints
# -------------------------------------------------------------------------


class _SettingPatchInput(rf_serializers.Serializer):
    kind = rf_serializers.ChoiceField(choices=NotificationKind.choices)
    enabled = rf_serializers.BooleanField()


class NotificationSettingsView(APIView):
    """GET /PATCH /api/v1/notifications/settings/ (#415)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        rows = list_notification_settings_for(request.user)
        return Response({"settings": rows})

    def patch(self, request: Request) -> Response:
        serializer = _SettingPatchInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        kind = serializer.validated_data["kind"]
        enabled = serializer.validated_data["enabled"]
        obj, _created = NotificationSetting.objects.update_or_create(
            user=request.user,
            kind=kind,
            defaults={"enabled": enabled},
        )
        return Response({"kind": obj.kind, "enabled": obj.enabled})
