"""Views for the tags app (P1-06, Issue #92).

SPEC §4 に沿って 3 つのエンドポイントを提供する:

    GET  /api/v1/tags/               -- タグ一覧 + インクリメンタルサーチ (AllowAny)
    GET  /api/v1/tags/<name>/        -- タグ詳細 (AllowAny)
    POST /api/v1/tags/propose/       -- タグ新規提案 (IsAuthenticated + CSRF)

未承認タグ (is_approved=False) は ``Tag.objects`` (= ApprovedTagManager) で
自動的に除外される。POST で新規作成されるタグも ``is_approved=False`` 起点のため、
モデレータが承認するまで search / detail には現れない。
"""

from __future__ import annotations

from django.db.models import Q, QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveAPIView
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.cookie_auth import CookieAuthentication, CSRFEnforcingAuthentication
from apps.tags.models import Tag
from apps.tags.serializers import (
    TagCreateSerializer,
    TagDetailSerializer,
    TagListSerializer,
)
from apps.tags.validators import find_similar_tags


class TagListView(ListAPIView):
    """タグ一覧 + インクリメンタルサーチ.

    SPEC §4:
        - ``?q=<prefix>`` で name の前方一致 + display_name の部分一致を検索
        - 結果は Meta の ``-usage_count, name`` (人気順 → name 昇順) に従う
        - 未承認タグは ``Tag.objects`` (ApprovedTagManager) の時点で除外
        - ページネーションは DRF 既定 (PageNumberPagination, PAGE_SIZE=10)

    権限: AllowAny (未ログインでも閲覧可能)
    """

    serializer_class = TagListSerializer
    permission_classes = [AllowAny]
    # DEFAULT_AUTHENTICATION_CLASSES が Cookie/JWT を拾う挙動になっているが、
    # AllowAny なので expired cookie 等で 401 を返さないよう明示的に空にする。
    authentication_classes: list = []

    def get_queryset(self) -> QuerySet[Tag]:
        """``?q=<prefix>`` で絞り込む. 空なら全件 (Manager が approved のみに絞り込む)."""
        queryset = Tag.objects.all()
        q = self.request.query_params.get("q", "").strip()
        if q:
            # name は小文字保存なので istartswith と startswith は等価だが、
            # 大文字入力でも引けるよう istartswith を使う。
            # display_name は大小混在なので icontains で部分一致にする。
            queryset = queryset.filter(Q(name__istartswith=q) | Q(display_name__icontains=q))
        return queryset


class TagDetailView(RetrieveAPIView):
    """タグ詳細 (``GET /api/v1/tags/<name>/``).

    - lookup は ``name__iexact`` で大文字小文字を無視。
    - 未承認タグは ``Tag.objects`` が除外するので 404 になる。
    - 権限: AllowAny。
    """

    serializer_class = TagDetailSerializer
    permission_classes = [AllowAny]
    authentication_classes: list = []
    # URL kwarg 名は ``name``。
    lookup_url_kwarg = "name"

    def get_queryset(self) -> QuerySet[Tag]:
        return Tag.objects.all()

    def get_object(self) -> Tag:
        """name の大文字小文字を無視して解決する.

        DRF 標準の ``get_object()`` は ``filter(**{lookup_field: value})`` と
        完全一致で引くため、``name__iexact`` を使うにはここで override する。
        """
        queryset = self.filter_queryset(self.get_queryset())
        name = self.kwargs[self.lookup_url_kwarg]
        obj = get_object_or_404(queryset, name__iexact=name)
        self.check_object_permissions(self.request, obj)
        return obj


class TagProposeView(APIView):
    """タグ新規提案 (``POST /api/v1/tags/propose/``).

    SPEC §4:
        1. ``validate_tag_name`` で format / length チェック (serializer 内)
        2. ``find_similar_tags`` で編集距離 2 以下の既存 approved タグを検索
        3. 近似タグが 1 件以上あれば 409 Conflict + ``similar_tags`` を返す
           (ユーザーが既存タグの選択に誘導されるようにする)
        4. 近似なしなら ``is_approved=False`` で Tag を作成し、201 を返す

    権限: IsAuthenticated + CSRF (Cookie 経由認証時).
    """

    # Cookie 経由の認証と、Cookie が無くても CSRF トークンを強制するための pre-auth
    # を組み合わせる (apps/users/views.py の LogoutView と同方針)。
    #
    # 注意: DRF の ``get_authenticate_header()`` は先頭 authenticator から
    # ``authenticate_header()`` を引いて 401 の WWW-Authenticate を組み立てる。
    # CSRFEnforcingAuthentication を先頭に置くと header が空になり、未認証時に
    # 403 が返ってしまう (LogoutView とは異なり、ここは未ログインユーザーも
    # 叩きうるエンドポイントなので 401 をきちんと返したい)。
    # そのため CookieAuthentication を先頭に置き、CSRFEnforcingAuthentication は
    # 2 番目に置くことで「Cookie 無し POST でも CSRF を強制しつつ、401 を返す」挙動にする。
    authentication_classes = [CookieAuthentication, CSRFEnforcingAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    # 他メソッドは 405 で弾く (副作用のある POST だけを受け付ける意図を明示する)。
    http_method_names = ["post", "head", "options"]

    def post(self, request: Request, *args, **kwargs) -> Response:
        serializer = TagCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        name = serializer.validated_data["name"]
        display_name = serializer.validated_data["display_name"]

        # 既存 approved タグとの編集距離チェック. 完全一致 (distance=0) も含めて
        # 返却することで、クライアントが「同名既存タグ」のケースと「似ているタグ」の
        # ケースを区別せずに選択候補として提示できる。
        similar = find_similar_tags(name)
        if similar:
            return Response(
                {
                    "detail": "A similar tag already exists.",
                    "similar_tags": [
                        {
                            "name": s.name,
                            "display_name": s.display_name,
                            "distance": s.distance,
                        }
                        for s in similar
                    ],
                },
                status=status.HTTP_409_CONFLICT,
            )

        # 承認済み群と被らないのでここで新規作成する. is_approved=False を起点とし、
        # モデレータ承認まで search / detail からは見えない。
        # all_objects を使って ApprovedTagManager の filter を回避する
        # (そうしないと直後の refresh_from_db で自分が見えなくなる)。
        tag = Tag.all_objects.create(
            name=name,
            display_name=display_name,
            created_by=request.user,
            is_approved=False,
        )

        return Response(
            {
                "name": tag.name,
                "display_name": tag.display_name,
                "usage_count": tag.usage_count,
                "is_approved": tag.is_approved,
            },
            status=status.HTTP_201_CREATED,
        )
