"""DRF views for boards (Phase 5).

匿名 GET / 認証必須 POST / 本人 + admin DELETE の 3 系統。
"""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.exceptions import APIException
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework.views import APIView

from apps.boards.models import Board, Thread, ThreadPost
from apps.boards.s3_presign import generate_thread_post_image_upload_url
from apps.boards.serializers import (
    BoardSerializer,
    ImageUploadUrlSerializer,
    ThreadCreateSerializer,
    ThreadDetailSerializer,
    ThreadPostCreateSerializer,
    ThreadPostSerializer,
    ThreadSerializer,
    serialize_thread_state,
)
from apps.boards.services import (
    THREAD_POST_HARD_LIMIT,
    ThreadLocked,
    append_post,
    create_thread_with_first_post,
)

_THREAD_LOCKED_BODY = {
    "detail": (
        f"このスレッドはレス上限 ({THREAD_POST_HARD_LIMIT}) に達しています。"
        "新しいスレッドを立ててください。"
    ),
    "code": "thread_locked",
}


def _thread_locked_response() -> Response:
    return Response(_THREAD_LOCKED_BODY, status=status.HTTP_423_LOCKED)


class ThreadLockedAPIException(APIException):
    """compat: コード経路でも raise できるが、view 内では _thread_locked_response()
    を直接 return することで body shape を {"detail": ..., "code": ...} に
    安定させる。"""

    status_code = status.HTTP_423_LOCKED
    default_detail = _THREAD_LOCKED_BODY["detail"]
    default_code = _THREAD_LOCKED_BODY["code"]


class BoardsThreadCreateThrottle(UserRateThrottle):
    scope = "boards_thread_create"


class BoardsPostCreateThrottle(UserRateThrottle):
    scope = "boards_post_create"


class BoardsImagePresignThrottle(UserRateThrottle):
    scope = "boards_image_presign"


class ThreadListPagination(PageNumberPagination):
    page_size = 30
    page_size_query_param = "page_size"
    max_page_size = 50


class PostListPagination(PageNumberPagination):
    # boards-spec §3.1 で「ページサイズ 50」と固定指定。
    # python-reviewer MEDIUM #6: page_size_query_param を撤去してクライアント上書き不可。
    page_size = 50


class BoardListView(generics.ListAPIView):
    """`GET /api/v1/boards/` — 板一覧 (匿名 OK)."""

    queryset = Board.objects.all().order_by("order", "id")
    serializer_class = BoardSerializer
    permission_classes = [AllowAny]
    pagination_class = None


class BoardDetailView(generics.RetrieveAPIView):
    """`GET /api/v1/boards/<slug>/` — 板詳細 (匿名 OK)."""

    queryset = Board.objects.all()
    serializer_class = BoardSerializer
    permission_classes = [AllowAny]
    lookup_field = "slug"


class BoardThreadListView(generics.ListCreateAPIView):
    """`GET / POST /api/v1/boards/<slug>/threads/`."""

    serializer_class = ThreadSerializer
    pagination_class = ThreadListPagination

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    def get_throttles(self):
        if self.request.method == "POST":
            return [BoardsThreadCreateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        slug = self.kwargs["slug"]
        get_object_or_404(Board, slug=slug)
        return (
            Thread.objects.filter(board__slug=slug, is_deleted=False)
            .select_related("author", "board")
            .order_by("-last_post_at")
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        slug = self.kwargs["slug"]
        board = get_object_or_404(Board, slug=slug)

        in_ser = ThreadCreateSerializer(data=request.data)
        in_ser.is_valid(raise_exception=True)
        try:
            thread, first_post = create_thread_with_first_post(
                board=board,
                author=request.user,
                title=in_ser.validated_data["title"],
                body=in_ser.validated_data["first_post_body"],
                images=in_ser.validated_data.get("first_post_images", []),
            )
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages, "code": "invalid"}, status=400)
        except ThreadLocked:  # pragma: no cover - 新規 Thread では発生しない
            return _thread_locked_response()

        out = ThreadSerializer(thread).data
        out["first_post"] = ThreadPostSerializer(first_post).data
        out["thread_state"] = serialize_thread_state(thread)
        return Response(out, status=status.HTTP_201_CREATED)


class ThreadDetailView(generics.RetrieveAPIView):
    """`GET /api/v1/threads/<id>/` — スレ詳細 (匿名 OK).

    python-reviewer LOW #9 反映: ``thread_state`` を含めて返し、
    フロントが初期描画時点で 990 警告 / 1000 lock を判定できるようにする。
    """

    serializer_class = ThreadDetailSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return Thread.objects.filter(is_deleted=False).select_related("author", "board")

    def retrieve(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        instance = self.get_object()
        data = self.get_serializer(instance).data
        data["thread_state"] = serialize_thread_state(instance)
        return Response(data)


class ThreadPostListCreateView(generics.ListCreateAPIView):
    """`GET / POST /api/v1/threads/<id>/posts/`."""

    serializer_class = ThreadPostSerializer
    pagination_class = PostListPagination

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated()]
        return [AllowAny()]

    def get_throttles(self):
        if self.request.method == "POST":
            return [BoardsPostCreateThrottle()]
        return super().get_throttles()

    def get_queryset(self):
        thread_id = self.kwargs["thread_id"]
        get_object_or_404(Thread, pk=thread_id, is_deleted=False)
        return (
            ThreadPost.objects.filter(thread_id=thread_id)
            .select_related("author")
            .prefetch_related("images")
            .order_by("number")
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        thread_id = self.kwargs["thread_id"]
        thread = get_object_or_404(Thread, pk=thread_id, is_deleted=False)

        in_ser = ThreadPostCreateSerializer(data=request.data)
        in_ser.is_valid(raise_exception=True)

        try:
            post = append_post(
                thread,
                request.user,
                body=in_ser.validated_data["body"],
                images=in_ser.validated_data.get("images", []),
            )
        except ThreadLocked:
            return _thread_locked_response()
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages, "code": "invalid"}, status=400)

        thread.refresh_from_db()
        out = ThreadPostSerializer(post).data
        out["thread_state"] = serialize_thread_state(thread)
        return Response(out, status=status.HTTP_201_CREATED)


class ThreadPostDeleteView(APIView):
    """`DELETE /api/v1/posts/<id>/` — 論理削除 (本人 + admin のみ)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, post_id: int) -> Response:
        # python-reviewer HIGH #1: 認可チェックを先に行う。is_deleted=True の post に対して
        # 非所有者がリクエストすると 204 (idempotent) ではなく 403 を返す。
        # 既存 post の存在情報を漏らさない (404 で OK だが、404→403 で済むなら 403)。
        post = get_object_or_404(ThreadPost, pk=post_id)
        is_author = post.author_id is not None and post.author_id == request.user.pk
        is_admin = bool(getattr(request.user, "is_staff", False))
        if not (is_author or is_admin):
            return Response({"detail": "削除権限がありません。"}, status=403)

        if post.is_deleted:
            return Response(status=status.HTTP_204_NO_CONTENT)

        post.is_deleted = True
        post.deleted_at = timezone.now()
        post.save(update_fields=["is_deleted", "deleted_at", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ThreadPostImageUploadUrlView(APIView):
    """`POST /api/v1/boards/thread-post-images/upload-url/`."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [BoardsImagePresignThrottle]

    def post(self, request: Request) -> Response:
        ser = ImageUploadUrlSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        try:
            res = generate_thread_post_image_upload_url(
                user_id=request.user.pk,
                content_type=ser.validated_data["content_type"],
                content_length=ser.validated_data["content_length"],
            )
        except DjangoValidationError as exc:
            return Response({"detail": exc.messages, "code": "image_too_large"}, status=400)
        return Response(res.to_dict(), status=200)
