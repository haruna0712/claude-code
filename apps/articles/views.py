"""DRF views for articles CRUD (#526 / Phase 6 P6-03).

docs/issues/phase-6.md P6-03 + SPEC §12 を実装。

- GET    /articles/              公開記事一覧 (匿名 OK、cursor pagination)
- POST   /articles/              新規作成 (auth、status=draft 既定、tags 0..5)
- GET    /articles/<slug>/        詳細 (匿名 OK、ただし draft は本人のみ → 他は 404)
- PATCH  /articles/<slug>/        編集 (本人のみ)
- DELETE /articles/<slug>/        論理削除 (本人 + admin)
- GET    /articles/me/drafts/    自分の下書き一覧 (auth)

権限:
- 匿名は published のみ閲覧可
- draft は本人のみ閲覧 / 編集 / 削除
- admin は全件削除可

その他:
- 一覧 fetch は cursor pagination (`?cursor=`)
- フィルタ: `?author=<handle>`, `?tag=<slug>`
- view_count は GET /articles/<slug>/ で +1 (本人除外、F() expression)
- rate limit: scope=article_write 30/hour
- slug 衝突は 400 (`(slug)` グローバル一意)
"""

from __future__ import annotations

import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import F
from django.utils import timezone
from rest_framework import generics, permissions, status, throttling
from rest_framework.exceptions import NotFound
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.pagination import CursorPagination
from rest_framework.permissions import SAFE_METHODS
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.articles import s3_presign as _presign
from apps.articles.models import Article, ArticleStatus, ArticleTag
from apps.articles.serializers import (
    ArticleCreateInputSerializer,
    ArticleDetailSerializer,
    ArticleImageOutputSerializer,
    ArticleSummarySerializer,
    ArticleUpdateInputSerializer,
    ConfirmImageInputSerializer,
    PresignImageInputSerializer,
)
from apps.articles.services.images import confirm_image

logger = logging.getLogger(__name__)


class _ArticleWriteThrottle(throttling.UserRateThrottle):
    scope = "article_write"


class _ArticleImagePresignThrottle(throttling.ScopedRateThrottle):
    scope = "article_image_presign"


class _ArticleImageConfirmThrottle(throttling.ScopedRateThrottle):
    scope = "article_image_confirm"


class _ArticleListPagination(CursorPagination):
    """公開記事 TL の cursor pagination (新しい順)."""

    page_size = 20
    ordering = "-published_at"
    cursor_query_param = "cursor"


class _DraftListPagination(CursorPagination):
    """自分の下書き一覧 (更新が新しい順)."""

    page_size = 20
    ordering = "-updated_at"
    cursor_query_param = "cursor"


class ArticleListCreateView(generics.GenericAPIView):
    """`GET /articles/` (匿名 OK) + `POST /articles/` (auth)."""

    pagination_class = _ArticleListPagination

    def get_throttles(self):
        if self.request.method == "POST":
            return [_ArticleWriteThrottle()]
        return []

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        qs = (
            Article.objects.filter(status=ArticleStatus.PUBLISHED)
            .select_related("author")
            .prefetch_related("article_tags__tag")
        )
        author = self.request.query_params.get("author")
        if author:
            qs = qs.filter(author__username=author)
        tag = self.request.query_params.get("tag")
        if tag:
            qs = qs.filter(article_tags__tag__name=tag).distinct()
        return qs

    def get(self, request: Request) -> Response:
        page = self.paginate_queryset(self.get_queryset())
        serializer = ArticleSummarySerializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    def post(self, request: Request) -> Response:
        serializer = ArticleCreateInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        published_at = timezone.now() if data["status"] == ArticleStatus.PUBLISHED else None

        try:
            article = Article.objects.create(
                author=request.user,
                title=data["title"],
                slug=data["slug"],
                body_markdown=data["body_markdown"],
                status=data["status"],
                published_at=published_at,
            )
        except IntegrityError:
            return Response(
                {"slug": "この slug は既に使われています"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for sort_order, tag in enumerate(data.get("tags") or []):
            ArticleTag.objects.create(article=article, tag=tag, sort_order=sort_order)

        return Response(
            ArticleDetailSerializer(article).data,
            status=status.HTTP_201_CREATED,
        )


class ArticleDetailView(APIView):
    """`GET/PATCH/DELETE /articles/<slug>/`."""

    def get_permissions(self):
        if self.request.method in SAFE_METHODS:
            return [permissions.AllowAny()]
        return [permissions.IsAuthenticated()]

    def get_throttles(self):
        if self.request.method in {"PATCH", "DELETE"}:
            return [_ArticleWriteThrottle()]
        return []

    def _get_visible_article(self, request: Request, slug: str) -> Article:
        """匿名は published のみ、authenticated は自分の draft も見られる."""

        article = (
            Article.objects.select_related("author")
            .prefetch_related("article_tags__tag")
            .filter(slug=slug)
            .first()
        )
        if article is None:
            raise NotFound("article not found")
        if article.status == ArticleStatus.DRAFT:
            if not request.user.is_authenticated:
                raise NotFound("article not found")
            if article.author_id != request.user.pk:
                raise NotFound("article not found")
        return article

    def get(self, request: Request, slug: str) -> Response:
        article = self._get_visible_article(request, slug)
        # view_count は本人除外で +1。F() で race-safe に。
        if request.user.is_authenticated and request.user.pk != article.author_id:
            Article.objects.filter(pk=article.pk).update(view_count=F("view_count") + 1)
            article.refresh_from_db(fields=["view_count"])
        return Response(ArticleDetailSerializer(article).data)

    def _get_owned_article(self, request: Request, slug: str) -> Article:
        article = Article.objects.filter(slug=slug).first()
        if article is None:
            raise NotFound("article not found")
        if article.author_id != request.user.pk:
            raise NotFound("article not found")
        return article

    def patch(self, request: Request, slug: str) -> Response:
        article = self._get_owned_article(request, slug)
        serializer = ArticleUpdateInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        old_status = article.status
        if "status" in data and data["status"] != old_status:
            article.status = data["status"]
            if data["status"] == ArticleStatus.PUBLISHED and article.published_at is None:
                article.published_at = timezone.now()
        if "title" in data:
            article.title = data["title"]
        if "slug" in data:
            article.slug = data["slug"]
        if "body_markdown" in data:
            article.body_markdown = data["body_markdown"]

        try:
            article.save()
        except IntegrityError:
            return Response(
                {"slug": "この slug は既に使われています"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if "tags" in data:
            article.article_tags.all().delete()
            for sort_order, tag in enumerate(data["tags"]):
                ArticleTag.objects.create(article=article, tag=tag, sort_order=sort_order)

        return Response(ArticleDetailSerializer(article).data)

    def delete(self, request: Request, slug: str) -> Response:
        article = Article.objects.filter(slug=slug).first()
        if article is None:
            raise NotFound("article not found")
        if article.author_id != request.user.pk and not request.user.is_staff:
            raise NotFound("article not found")
        article.soft_delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MyDraftListView(generics.ListAPIView):
    """`GET /articles/me/drafts/` 自分の下書き一覧 (auth)."""

    permission_classes = [permissions.IsAuthenticated]
    pagination_class = _DraftListPagination
    serializer_class = ArticleSummarySerializer

    def get_queryset(self):
        return (
            Article.objects.filter(author=self.request.user, status=ArticleStatus.DRAFT)
            .select_related("author")
            .prefetch_related("article_tags__tag")
        )


# ---------------------------------------------------------------------------
# 画像アップロード (P6-04 / docs/specs/article-image-upload-spec.md)
# ---------------------------------------------------------------------------


class PresignArticleImageView(APIView):
    """``POST /api/v1/articles/images/presign/``: 記事内画像の presigned POST URL を発行する.

    body: ``{"filename": str, "mime_type": str, "size": int}``
    response (200): ``{"url", "fields", "s3_key", "expires_at"}``

    認可:
    - 認証必須 (``IsAuthenticated``)
    - throttle ``article_image_presign`` 30/hour (stg 300/hour) で濫用抑制
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [_ArticleImagePresignThrottle]

    def post(self, request: Request) -> Response:
        serializer = PresignImageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            result = _presign.generate_presigned_image_upload(
                user_id=request.user.pk,
                mime_type=data["mime_type"],
                size=data["size"],
                filename=data["filename"],
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc

        # 監査用: 署名済 URL 本体 (credentials を含む) は残さず object_key のみ記録。
        logger.info(
            "articles.image_presign.issued",
            extra={
                "event": "articles.image_presign.issued",
                "user_id": request.user.pk,
                "s3_key": result.s3_key,
            },
        )

        return Response(
            {
                "url": result.url,
                "fields": result.fields,
                "s3_key": result.s3_key,
                "expires_at": result.expires_at.isoformat(),
            },
            status=status.HTTP_200_OK,
        )


class ConfirmArticleImageView(APIView):
    """``POST /api/v1/articles/images/confirm/``: presign で PUT 完了した画像を確定する.

    body: ``{"s3_key", "filename", "mime_type", "size", "width", "height"}``
    response (201): ``ArticleImageOutputSerializer`` 全フィールド (id, s3_key, url, width, height, size, created_at)

    フロー (services.images.confirm_image を参照):
    1. s3_key prefix が ``articles/<request.user.pk>/`` で始まることを再検証 (IDOR 防止)
    2. ``head_object`` で S3 上の実物 metadata と申告を再検証 (改ざん防止)
    3. orphan ``ArticleImage`` (article=None) を作成
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [_ArticleImageConfirmThrottle]

    def post(self, request: Request) -> Response:
        serializer = ConfirmImageInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            image = confirm_image(
                user=request.user,
                s3_key=data["s3_key"],
                filename=data["filename"],
                mime_type=data["mime_type"],
                size=data["size"],
                width=data["width"],
                height=data["height"],
            )
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.messages) from exc

        logger.info(
            "articles.image_confirm.created",
            extra={
                "event": "articles.image_confirm.created",
                "user_id": request.user.pk,
                "image_id": str(image.id),
                "s3_key": image.s3_key,
            },
        )

        return Response(
            ArticleImageOutputSerializer(image).data,
            status=status.HTTP_201_CREATED,
        )
