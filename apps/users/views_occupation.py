"""Phase 12 P12-06: Occupation 関連 view を分離するモジュール.

``apps/users/views.py`` が 800 行上限を超えるため、 Occupation 系を別ファイルに
切り出している (code-reviewer HIGH 指摘)。 内容としては:

- ``OccupationListView``  : ``GET /api/v1/occupations/`` (anon 可)
- ``MyOccupationsView``   : ``GET / PUT /api/v1/users/me/occupations/`` (auth)

spec: docs/specs/phase-12-residence-map-spec.md §9
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import QuerySet
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.cookie_auth import CookieAuthentication, CSRFEnforcingAuthentication
from apps.users.models import Occupation, UserOccupation
from apps.users.serializers import (
    MyOccupationsWriteSerializer,
    OccupationSerializer,
)


class OccupationListView(ListAPIView):
    """``GET /api/v1/occupations/``: controlled vocabulary を返す (anon 可)。

    廃止職業 (``is_active=False``) は除外。 ordering は
    ``Occupation.Meta.ordering`` (= ``display_order, slug``)。
    pagination は無し (16 件程度のため)。
    """

    serializer_class = OccupationSerializer
    permission_classes = [AllowAny]
    pagination_class = None

    def get_queryset(self) -> QuerySet:
        return Occupation.objects.filter(is_active=True)


class MyOccupationsView(APIView):
    """``/api/v1/users/me/occupations/`` — 自分の occupations の GET / PUT.

    - GET: ``{"slugs": [...]}`` で自分の slug 配列を返す。 未設定は空配列。
    - PUT: ``{"slugs": [...]}`` で **置換** semantics。 最大 3 件。

    認証は Cookie + CSRF。 ``MyUserResidenceView`` 等プロジェクトの状態変更
    エンドポイントと揃えて ``CSRFEnforcingAuthentication`` を明示する
    (グローバル fallback の ``JWTAuthentication`` では PUT 時に CSRF が
    効かない経路があるため、 二重防衛のために authentication_classes を明示)。
    """

    authentication_classes = [CSRFEnforcingAuthentication, CookieAuthentication]
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]
    # 意図しない HTTP method 経由の副作用を防ぐ (プロジェクト規約)。
    http_method_names = ["get", "put", "head", "options"]

    def _current_slugs(self, request: Request) -> list[str]:
        return list(request.user.occupations.filter(is_active=True).values_list("slug", flat=True))

    def get(self, request: Request) -> Response:
        return Response(
            {"slugs": self._current_slugs(request)},
            status=status.HTTP_200_OK,
        )

    def put(self, request: Request) -> Response:
        serializer = MyOccupationsWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        slugs: list[str] = serializer.validated_data["slugs"]

        # 置換: 既存 UserOccupation を全消ししてから新しい slug 集合を bulk insert。
        # トランザクション内で実行して、 中途半端な状態を残さない。 admin が
        # トランザクション中に ``is_active=False`` に切り替える race window では、
        # ``bulk_create`` 直前の件数チェックで検知し、 ``set_rollback`` で DELETE
        # も巻き戻す (database-reviewer HIGH: ``with atomic(): return`` だけだと
        # block は正常終了扱いで commit されてしまうため明示 rollback が必須)。
        race_missing: list[str] = []
        with transaction.atomic():
            UserOccupation.objects.filter(user=request.user).delete()
            if slugs:
                occupations = list(Occupation.objects.filter(slug__in=slugs, is_active=True))
                if len(occupations) != len(slugs):
                    race_missing = sorted(set(slugs) - {o.slug for o in occupations})
                    transaction.set_rollback(True)
                else:
                    UserOccupation.objects.bulk_create(
                        [UserOccupation(user=request.user, occupation=o) for o in occupations]
                    )

        if race_missing:
            return Response(
                {
                    "slugs": [
                        f"職業が一時的に利用できません。 再試行してください: {', '.join(race_missing)}"
                    ]
                },
                status=status.HTTP_409_CONFLICT,
            )

        # 成功時は validate 済みの slug を直接返す (race window が無いので確定的)。
        return Response({"slugs": slugs}, status=status.HTTP_200_OK)
