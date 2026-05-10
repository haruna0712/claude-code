"""DRF views for お気に入り (#499).

docs/specs/favorites-spec.md §4 を実装する。本人以外は 404 隠蔽 (SPEC §9)。

エンドポイント:
- GET    /folders/                     一覧 (フラット、tree は FE で構築)
- POST   /folders/                     新規作成
- GET    /folders/<id>/                単一詳細
- PATCH  /folders/<id>/                rename / move
- DELETE /folders/<id>/                削除 (CASCADE で子 + bookmark)
- GET    /folders/<id>/bookmarks/      フォルダ内 bookmark 一覧
- POST   /bookmarks/                   保存 (idempotent)
- DELETE /bookmarks/<id>/              削除
- GET    /tweets/<id>/bookmark-status/ どの folder に保存済か
"""

from __future__ import annotations

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.boxes.models import Bookmark, Folder
from apps.boxes.serializers import (
    BookmarkCreateInputSerializer,
    BookmarkSerializer,
    BookmarkStatusSerializer,
    FolderCreateInputSerializer,
    FolderSerializer,
    FolderUpdateInputSerializer,
)


def _annotated_user_folders(user):
    """user の folder を bookmark_count / child_count 付きで返す."""

    return (
        Folder.objects.filter(user=user)
        .annotate(
            bookmark_count=Count("bookmarks", distinct=True),
            child_count=Count("children", distinct=True),
        )
        .order_by("parent_id", "sort_order", "id")
    )


class FolderListCreateView(APIView):
    """``GET/POST /folders/``."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = _annotated_user_folders(request.user)
        return Response({"results": FolderSerializer(qs, many=True).data})

    def post(self, request: Request) -> Response:
        serializer = FolderCreateInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        parent = None
        parent_id = data.get("parent_id")
        if parent_id is not None:
            parent = Folder.objects.filter(pk=parent_id, user=request.user).first()
            if parent is None:
                raise DRFValidationError({"parent_id": "無効な parent_id"})

        # 同一親で同名禁止 (DB 制約でも reject されるが先に明示)
        if Folder.objects.filter(user=request.user, parent=parent, name=data["name"]).exists():
            raise DRFValidationError({"name": "同名フォルダが存在します"})

        folder = Folder(user=request.user, parent=parent, name=data["name"])
        try:
            with transaction.atomic():
                folder.clean()
                folder.save()
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.message_dict) from exc

        # 直作成だと count annotation が無いので 0 で埋める
        folder.bookmark_count = 0  # type: ignore[attr-defined]
        folder.child_count = 0  # type: ignore[attr-defined]
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)


class FolderDetailView(APIView):
    """``GET/PATCH/DELETE /folders/<id>/``."""

    permission_classes = [permissions.IsAuthenticated]

    def _get_folder(self, request: Request, pk: int) -> Folder:
        # annotate 付きで取得 (本人のみ、他人は 404 隠蔽)
        folder = _annotated_user_folders(request.user).filter(pk=pk).first()
        if folder is None:
            raise NotFound("folder not found")
        return folder

    def get(self, request: Request, pk: int) -> Response:
        folder = self._get_folder(request, pk)
        return Response(FolderSerializer(folder).data)

    def patch(self, request: Request, pk: int) -> Response:
        folder = self._get_folder(request, pk)
        serializer = FolderUpdateInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # parent_id を先に解決して effective parent を確定させてから
        # sibling 同名チェックを走らせる (rename + move 同時 PATCH の整合性)。
        if "parent_id" in data:
            new_parent_id = data["parent_id"]
            if new_parent_id is None:
                folder.parent = None
            else:
                new_parent = Folder.objects.filter(pk=new_parent_id, user=request.user).first()
                if new_parent is None:
                    raise DRFValidationError({"parent_id": "無効な parent_id"})
                folder.parent = new_parent

        if "name" in data:
            new_name = data["name"]
            sibling_qs = Folder.objects.filter(
                user=request.user, parent_id=folder.parent_id, name=new_name
            ).exclude(pk=folder.pk)
            if sibling_qs.exists():
                raise DRFValidationError({"name": "同名フォルダが存在します"})
            folder.name = new_name

        try:
            with transaction.atomic():
                folder.clean()
                folder.save()
        except DjangoValidationError as exc:
            raise DRFValidationError(detail=exc.message_dict) from exc

        return Response(FolderSerializer(self._get_folder(request, pk)).data)

    def delete(self, request: Request, pk: int) -> Response:
        folder = self._get_folder(request, pk)
        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class FolderBookmarksView(generics.ListAPIView):
    """``GET /folders/<id>/bookmarks/``."""

    permission_classes = [permissions.IsAuthenticated]
    serializer_class = BookmarkSerializer

    def get_queryset(self):
        pk = self.kwargs["pk"]
        # 1 query で folder の本人所有を兼ねた絞り込み (他人 / 存在しない folder は 404)
        if not Folder.objects.filter(pk=pk, user=self.request.user).exists():
            raise NotFound("folder not found")
        return (
            Bookmark.objects.filter(folder_id=pk, folder__user=self.request.user)
            .select_related("tweet")
            .order_by("-created_at")
        )


class BookmarkCreateView(APIView):
    """``POST /bookmarks/`` — idempotent."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = BookmarkCreateInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        folder = Folder.objects.filter(pk=data["folder_id"], user=request.user).first()
        if folder is None:
            raise DRFValidationError({"folder_id": "無効な folder_id"})

        from apps.tweets.models import Tweet  # 遅延 import で循環回避

        # 論理削除済 tweet (is_deleted=True) は bookmark 不可。
        if not Tweet.objects.filter(pk=data["tweet_id"], is_deleted=False).exists():
            raise DRFValidationError({"tweet_id": "ツイートが見つかりません"})

        # `get_or_create` は完全並行下で IntegrityError を投げ得るので
        # transaction.atomic + IntegrityError 拾いでフォールバックして idempotent を維持。
        try:
            with transaction.atomic():
                bookmark, created = Bookmark.objects.get_or_create(
                    user=request.user,
                    folder=folder,
                    tweet_id=data["tweet_id"],
                )
        except IntegrityError:
            bookmark = Bookmark.objects.get(
                user=request.user, folder=folder, tweet_id=data["tweet_id"]
            )
            created = False

        return Response(
            BookmarkSerializer(bookmark).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class BookmarkDestroyView(APIView):
    """``DELETE /bookmarks/<id>/``."""

    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request: Request, pk: int) -> Response:
        bookmark = get_object_or_404(Bookmark, pk=pk, user=request.user)
        bookmark.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class TweetBookmarkStatusView(APIView):
    """``GET /tweets/<tweet_id>/bookmark-status/``."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, tweet_id: int) -> Response:
        # frontend が削除時に bookmark_id を直接引けるよう、folder_id → bookmark_id
        # を返す (typescript-reviewer #502 H4 対応で N+1 listFolderBookmarks を不要化)。
        rows = Bookmark.objects.filter(user=request.user, tweet_id=tweet_id).values_list(
            "folder_id", "id"
        )
        bookmark_ids = {str(folder_id): bookmark_id for folder_id, bookmark_id in rows}
        folder_ids = sorted(int(k) for k in bookmark_ids)
        return Response(
            BookmarkStatusSerializer({"folder_ids": folder_ids, "bookmark_ids": bookmark_ids}).data
        )
