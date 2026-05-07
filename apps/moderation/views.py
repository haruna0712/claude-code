"""DRF views for moderation (Phase 4B / Issues #443 #444 #446)."""

from __future__ import annotations

from typing import Any

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.moderation.models import Block, Mute, Report
from apps.moderation.serializers import (
    BlockSerializer,
    MuteSerializer,
    ReportCreateSerializer,
    ReportOutSerializer,
)

User = get_user_model()


class ModerationBlockThrottle(UserRateThrottle):
    scope = "moderation_block"


class ModerationMuteThrottle(UserRateThrottle):
    scope = "moderation_mute"


class ModerationReportThrottle(UserRateThrottle):
    scope = "moderation_report"


def _self_target_response(detail: str = "自分自身は対象にできません。") -> Response:
    return Response({"detail": detail, "code": "self_target"}, status=400)


def _target_not_found_response() -> Response:
    return Response(
        {"detail": "対象ユーザーが見つかりません。", "code": "target_not_found"},
        status=400,
    )


class BlockListCreateView(generics.ListCreateAPIView):
    """`GET / POST /api/v1/moderation/blocks/`."""

    serializer_class = BlockSerializer
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == "POST":
            return [ModerationBlockThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        return (
            Block.objects.filter(blocker=self.request.user)
            .select_related("blockee")
            .order_by("-created_at")
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        target_handle = request.data.get("target_handle", "").strip()
        if not target_handle:
            return _target_not_found_response()
        target = User.objects.filter(username=target_handle, is_active=True).first()
        if target is None:
            return _target_not_found_response()
        if target.pk == request.user.pk:
            return _self_target_response()

        with transaction.atomic():
            block, _ = Block.objects.get_or_create(blocker=request.user, blockee=target)
            # 既存 follow を双方向で解消 (lazy import: Follow が無くても動く)
            try:
                from apps.follows.models import Follow

                Follow.objects.filter(
                    Q(follower=request.user, followee=target)
                    | Q(follower=target, followee=request.user)
                ).delete()
            except ImportError:  # pragma: no cover
                pass

        return Response(BlockSerializer(block).data, status=201)


class BlockDeleteView(APIView):
    """`DELETE /api/v1/moderation/blocks/<handle>/`."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ModerationBlockThrottle]

    def delete(self, request: Request, handle: str) -> Response:
        target = User.objects.filter(username=handle).first()
        if target is None:
            return Response(status=204)  # idempotent
        Block.objects.filter(blocker=request.user, blockee=target).delete()
        return Response(status=204)


class MuteListCreateView(generics.ListCreateAPIView):
    """`GET / POST /api/v1/moderation/mutes/`."""

    serializer_class = MuteSerializer
    permission_classes = [IsAuthenticated]

    def get_throttles(self):
        if self.request.method == "POST":
            return [ModerationMuteThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        return (
            Mute.objects.filter(muter=self.request.user)
            .select_related("mutee")
            .order_by("-created_at")
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        target_handle = request.data.get("target_handle", "").strip()
        if not target_handle:
            return _target_not_found_response()
        target = User.objects.filter(username=target_handle, is_active=True).first()
        if target is None:
            return _target_not_found_response()
        if target.pk == request.user.pk:
            return _self_target_response()
        mute, _ = Mute.objects.get_or_create(muter=request.user, mutee=target)
        return Response(MuteSerializer(mute).data, status=201)


class MuteDeleteView(APIView):
    """`DELETE /api/v1/moderation/mutes/<handle>/`."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ModerationMuteThrottle]

    def delete(self, request: Request, handle: str) -> Response:
        target = User.objects.filter(username=handle).first()
        if target is None:
            return Response(status=204)
        Mute.objects.filter(muter=request.user, mutee=target).delete()
        return Response(status=204)


class ReportCreateView(APIView):
    """`POST /api/v1/moderation/reports/`."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ModerationReportThrottle]

    def post(self, request: Request) -> Response:
        ser = ReportCreateSerializer(data=request.data, context={"request": request})
        if not ser.is_valid():
            # serializer ValidationError から code を抽出 (self_target / invalid_target)
            code = "invalid"
            for field_errors in ser.errors.values():
                if not isinstance(field_errors, list):
                    continue
                for err in field_errors:
                    c = getattr(err, "code", None)
                    if c in {"self_target", "invalid_target"}:
                        code = c
                        break
                if code != "invalid":
                    break
            return Response({"detail": ser.errors, "code": code}, status=400)

        report = Report.objects.create(
            reporter=request.user,
            target_type=ser.validated_data["target_type"],
            target_id=ser.validated_data["target_id"],
            reason=ser.validated_data["reason"],
            note=ser.validated_data.get("note", ""),
        )
        return Response(ReportOutSerializer(report).data, status=201)
