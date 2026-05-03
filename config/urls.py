from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from drf_yasg.views import get_schema_view
from rest_framework import permissions

from apps.common.views import csrf_token as csrf_token_view
from apps.common.views import health as health_view
from config.openapi import api_info

schema_view = get_schema_view(
    api_info,
    public=True,
    permission_classes=[permissions.AllowAny],
)

urlpatterns = [
    # ALB target group の health check が叩くエンドポイント (P0.5-11)。
    # /api/v1/ より短い /api/health/ に置き、ALB listener rule の /api/* が
    # app target group に流した時にそのまま 200 を返す。
    path("api/health/", health_view, name="api-health"),
    path(
        "redoc/",
        schema_view.with_ui("redoc", cache_timeout=0),
        name="schema-redoc",
    ),
    # OpenAPI 3.0 schema (drf-spectacular) — frontend codegen 用の正本。
    # drf-yasg は /redoc/ 人間向け UI のみで残置 (APIView で action_map=None
    # を踏むため codegen には使えない)。
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path(
        "api/schema/swagger-ui/",
        SpectacularSwaggerView.as_view(url_name="schema"),
        name="swagger-ui",
    ),
    path(
        "api/schema/redoc/",
        SpectacularRedocView.as_view(url_name="schema"),
        name="redoc-spectacular",
    ),
    path(settings.ADMIN_URL, admin.site.urls),
    # P1-13a: SPA が state-changing POST を送る前に csrftoken cookie を種付け
    # する bootstrap。djoser / apps.users.urls より前に登録して、include 先の
    # include が同名 path を上書きしないことを保証する (URLResolver は登録順)。
    path("api/v1/auth/csrf/", csrf_token_view, name="api-csrf"),
    path("api/v1/auth/", include("djoser.urls")),
    path("api/v1/auth/", include("apps.users.urls")),
    # P1-03 #89: プロフィール API (SPEC §2)。
    # /api/v1/users/me/ (GET/PATCH) と /api/v1/users/<handle>/ (GET) を提供。
    # 認証系 (/api/v1/auth/) と分離するため apps.users.urls_profile として別登録。
    path("api/v1/users/", include("apps.users.urls_profile")),
    # P2-03: フォロー関連 API は handle ベースで /api/v1/users/<handle>/follow/ などに
    # マウントする (SPEC §16.2 の RESTful URL 設計)。``urls_profile`` の <str:username>/
    # (1 セグメント) と本 include の <handle>/follow/ (2 セグメント) は衝突しない。
    path("api/v1/users/", include("apps.follows.urls")),
    # Phase 0 scaffold (P0-04). Each app ships empty urlpatterns until
    # the owning phase adds real endpoints (see docs/ROADMAP.md).
    path("api/v1/tweets/", include("apps.tweets.urls")),
    # P2-04: リアクションは /api/v1/tweets/<tweet_id>/reactions/ で tweet-rooted。
    # apps.tweets.urls の <pk>/ パターンと <tweet_id>/reactions/ は衝突しない。
    path("api/v1/tweets/", include("apps.reactions.urls")),
    path("api/v1/tags/", include("apps.tags.urls")),
    # P2-04: legacy /api/v1/reactions/ は tweet-rooted に移行したため、reactions の
    # スカフォールド include は削除済み。
    path("api/v1/boxes/", include("apps.boxes.urls")),
    path("api/v1/notifications/", include("apps.notifications.urls")),
    path("api/v1/dm/", include("apps.dm.urls")),
    path("api/v1/boards/", include("apps.boards.urls")),
    path("api/v1/articles/", include("apps.articles.urls")),
    path("api/v1/moderation/", include("apps.moderation.urls")),
    path("api/v1/bots/", include("apps.bots.urls")),
    path("api/v1/billing/", include("apps.billing.urls")),
    path("api/v1/search/", include("apps.search.urls")),
    # P2-08: タイムライン (home / following / explore)
    path("api/v1/timeline/", include("apps.timeline.urls")),
]

# Sentry smoke test endpoint (P0-06). DEBUG=True の環境だけ URL 登録すること自体を
# 行い、本番デプロイのルーティングテーブルに載らないようにする。
# (security-reviewer PR #38 MEDIUM 指摘反映)
# /api/health/ は本 urlpatterns 直接登録、debug-sentry のみ apps.common.urls に残す。
if settings.DEBUG:
    from apps.common.views import debug_sentry

    urlpatterns += [
        path("debug-sentry/", debug_sentry, name="debug-sentry"),
    ]

admin.site.site_header = "Admin"
admin.site.site_title = "Admin Portal"
admin.site.index_title = "Welcome to site"
