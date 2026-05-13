"""DRF views for mentorship endpoints.

P11-03: MentorRequest の CRUD API を実装。

- GET    /api/v1/mentor/requests/        anon 可、 cursor pagination、 status=open のみ、 tag filter
- POST   /api/v1/mentor/requests/        auth、 mentee=request.user
- GET    /api/v1/mentor/requests/<id>/   anon 可
- PATCH  /api/v1/mentor/requests/<id>/   owner only、 status=open のみ編集可
- DELETE /api/v1/mentor/requests/<id>/   owner only、 status=CLOSED に soft-delete
- POST   /api/v1/mentor/requests/<id>/close/  owner only、 手動 close

spec §6.1
"""

from __future__ import annotations

from django.db import IntegrityError, transaction
from django.db.models import F
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.generics import GenericAPIView
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.mentorship.models import MentorProposal, MentorRequest
from apps.mentorship.serializers import (
    MentorProposalDetailSerializer,
    MentorProposalInputSerializer,
    MentorRequestDetailSerializer,
    MentorRequestInputSerializer,
    MentorRequestSummarySerializer,
    MentorshipContractDetailSerializer,
)
from apps.mentorship.services import accept_proposal, get_proposal_or_404


class _MentorRequestListPagination(CursorPagination):
    """募集一覧の cursor pagination (新着順)。"""

    page_size = 20
    ordering = "-created_at"
    cursor_query_param = "cursor"


class MentorRequestListCreateView(GenericAPIView):
    """`GET /mentor/requests/` (anon) + `POST /mentor/requests/` (auth)。"""

    pagination_class = _MentorRequestListPagination

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        # 一覧は OPEN のみ可視 (matched / closed / expired は隠す)。
        qs = (
            MentorRequest.objects.filter(status=MentorRequest.Status.OPEN)
            .select_related("mentee")
            .prefetch_related("target_skill_tags")
        )
        tag = self.request.query_params.get("tag")
        if tag:
            qs = qs.filter(target_skill_tags__name=tag.lower()).distinct()
        return qs

    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = MentorRequestSummarySerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    def post(self, request: Request) -> Response:
        serializer = MentorRequestInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        tags = data.get("target_skill_tag_names") or []
        req = MentorRequest.objects.create(
            mentee=request.user,
            title=data["title"],
            body=data["body"],
            budget_jpy=data["budget_jpy"],
        )
        if tags:
            req.target_skill_tags.set(tags)
        return Response(
            MentorRequestDetailSerializer(req).data,
            status=status.HTTP_201_CREATED,
        )


def _get_request_or_404(pk: int) -> MentorRequest:
    req = (
        MentorRequest.objects.select_related("mentee")
        .prefetch_related("target_skill_tags")
        .filter(pk=pk)
        .first()
    )
    if req is None:
        raise NotFound("MentorRequest not found")
    return req


def _ensure_owner(req: MentorRequest, user) -> None:
    if not user.is_authenticated or req.mentee_id != user.pk:
        raise PermissionDenied("only the request owner can perform this action")


class MentorRequestDetailView(APIView):
    """`GET/PATCH/DELETE /mentor/requests/<id>/`。"""

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get(self, request: Request, pk: int) -> Response:
        req = _get_request_or_404(pk)
        # 一覧では OPEN のみ可視だが、 detail は MATCHED / CLOSED / EXPIRED でも参照可能
        # (mentee が「過去出した募集」 を URL で踏み戻す動線、 spec §6.1)。
        return Response(MentorRequestDetailSerializer(req).data)

    def patch(self, request: Request, pk: int) -> Response:
        req = _get_request_or_404(pk)
        _ensure_owner(req, request.user)
        if req.status != MentorRequest.Status.OPEN:
            return Response(
                {"detail": "編集できるのは募集中 (open) の投稿だけです"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MentorRequestInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        for field in ("title", "body", "budget_jpy"):
            if field in data:
                setattr(req, field, data[field])
        req.save(update_fields=["title", "body", "budget_jpy", "updated_at"])

        if "target_skill_tag_names" in data:
            req.target_skill_tags.set(data["target_skill_tag_names"])

        return Response(MentorRequestDetailSerializer(req).data)

    def delete(self, request: Request, pk: int) -> Response:
        """論理削除 (status=CLOSED に遷移)。 row は残す (proposal 履歴のため)。"""

        req = _get_request_or_404(pk)
        _ensure_owner(req, request.user)
        if req.status == MentorRequest.Status.CLOSED:
            return Response(status=status.HTTP_204_NO_CONTENT)
        req.status = MentorRequest.Status.CLOSED
        req.save(update_fields=["status", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MentorRequestCloseView(APIView):
    """`POST /mentor/requests/<id>/close/` — 手動 close (DELETE と同等の意味、 idempotent)。"""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        req = _get_request_or_404(pk)
        _ensure_owner(req, request.user)
        if req.status == MentorRequest.Status.CLOSED:
            return Response(MentorRequestDetailSerializer(req).data)
        req.status = MentorRequest.Status.CLOSED
        req.save(update_fields=["status", "updated_at"])
        return Response(MentorRequestDetailSerializer(req).data)


# --- MentorProposal (P11-04) ---


class MentorProposalCreateView(APIView):
    """`POST /mentor/requests/<request_id>/proposals/` — mentor が提案を出す。

    spec §6.2。
    - auth 必須
    - mentor == request.mentee は禁止 (自分の募集に提案できない)
    - request.status == OPEN のみ受付
    - 1 request に 1 mentor は 1 proposal のみ (unique constraint)
    - 提案投稿成功で request.proposal_count を atomic に +1
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, request_id: int) -> Response:
        try:
            mentor_request = MentorRequest.objects.select_related("mentee").get(pk=request_id)
        except MentorRequest.DoesNotExist as exc:
            raise NotFound("MentorRequest not found") from exc

        # 自分の募集には提案できない
        if mentor_request.mentee_id == request.user.pk:
            return Response(
                {"detail": "自分の募集には提案できません"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # OPEN 以外は受け付けない (MATCHED / CLOSED / EXPIRED)
        if mentor_request.status != MentorRequest.Status.OPEN:
            return Response(
                {"detail": "この募集は受付終了しています"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MentorProposalInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        body = serializer.validated_data["body"]

        try:
            with transaction.atomic():
                proposal = MentorProposal.objects.create(
                    request=mentor_request,
                    mentor=request.user,
                    body=body,
                )
                # cached counter を atomic に increment。
                MentorRequest.objects.filter(pk=mentor_request.pk).update(
                    proposal_count=F("proposal_count") + 1
                )
        except IntegrityError:
            # unique (request, mentor) 違反 = 既に proposal 投稿済
            return Response(
                {"detail": "この募集には既に提案を出しています"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            MentorProposalDetailSerializer(proposal).data,
            status=status.HTTP_201_CREATED,
        )


class MentorProposalAcceptView(APIView):
    """`POST /mentor/proposals/<id>/accept/` — mentee が proposal を accept する。

    spec §6.2 / §3.2。 service 層 `accept_proposal()` に委譲、
    `MentorshipContract` + DMRoom (kind=MENTORSHIP) を atomic に作成。
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        proposal = get_proposal_or_404(pk)
        contract = accept_proposal(proposal=proposal, by_user=request.user)
        return Response(
            MentorshipContractDetailSerializer(contract).data,
            status=status.HTTP_201_CREATED,
        )
