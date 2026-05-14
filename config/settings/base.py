import re
from datetime import timedelta
from os import getenv, path
from pathlib import Path

import sentry_sdk
from dotenv import load_dotenv
from sentry_sdk.integrations.celery import CeleryIntegration
from sentry_sdk.integrations.django import DjangoIntegration
from sentry_sdk.integrations.redis import RedisIntegration

BASE_DIR = Path(__file__).resolve(strict=True).parent.parent.parent
APPS_DIR = BASE_DIR / "apps"

local_env_file = path.join(BASE_DIR, ".envs", ".env.local")

if path.isfile(local_env_file):
    load_dotenv(local_env_file)


# --- Sentry observability (P0-06) ---
# DSN / environment / release はすべて env 経由。未設定なら SDK を無効化する。
# stg/prod では CI で必ず設定する（欠落は CD ワークフローで fail させる方針）。
SENTRY_DSN = getenv("SENTRY_DSN", "")
SENTRY_ENVIRONMENT = getenv("SENTRY_ENVIRONMENT", "local")
SENTRY_RELEASE = getenv("SENTRY_RELEASE")  # CI で git SHA を渡す


def _sentry_before_send(event, _hint):
    """Strip request body / form data / query string from Sentry events.

    security-reviewer (PR #38) フィードバック: DjangoIntegration は例外発生時に
    request.data / request.query_string をコンテキストとして送信する可能性がある。
    ツイート本文や DM 等のユーザー入力はどの API でも発生し得るため、一律で除去する。
    """
    request = event.get("request")
    if request:
        request.pop("data", None)
        request.pop("query_string", None)
        cookies = request.get("cookies")
        if cookies:
            # セッション Cookie などは PII に該当するため送らない
            request["cookies"] = {k: "[Filtered]" for k in cookies}
    return event


_SENTRY_SAMPLE_RATES = {
    "production": 0.1,
    "stg": 0.5,
    "local": 1.0,
}

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=SENTRY_ENVIRONMENT,
        release=SENTRY_RELEASE,
        integrations=[
            DjangoIntegration(),
            CeleryIntegration(),
            RedisIntegration(),
        ],
        # stg は prod より粗く、local はフルサンプリング。
        traces_sample_rate=_SENTRY_SAMPLE_RATES.get(SENTRY_ENVIRONMENT, 1.0),
        # PII は送らない。投稿本文やユーザー名が誤って Sentry に載らないようにする。
        send_default_pii=False,
        before_send=_sentry_before_send,
    )


# Application definition

DJANGO_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",  # P1-01: BLACKLIST_AFTER_ROTATION に必要
    "corsheaders",
    "django_countries",
    "phonenumber_field",
    "drf_yasg",
    "drf_spectacular",
    "djoser",
    "taggit",
    "django_filters",
    "djcelery_email",
    "social_django",  # P1-01 + P1-12: Google OAuth
    "storages",  # P1-01: django-storages (S3)
]

LOCAL_APPS = [
    # apps.common は P2-02 で pg_bigm / pg_trgm の CreateExtension migration を
    # ホストするため正式登録。models 自体は当面空。
    "apps.common",
    "apps.users",
    # Phase 0 scaffold (P0-04). Models/URLs are populated in later phases
    # — see docs/ROADMAP.md for ownership of each app.
    "apps.tweets",
    "apps.tags",
    "apps.follows",
    "apps.reactions",
    # P2-08: TL 配信 (永続モデルを持たない、サービス層のみ).
    "apps.timeline",
    "apps.boxes",
    "apps.notifications",
    "apps.dm",
    "apps.boards",
    "apps.articles",
    "apps.moderation",
    "apps.bots",
    "apps.billing",
    "apps.search",
    # Phase 11: メンターマッチング (P11-01)。 model 実装は P11-02 以降。
    "apps.mentorship",
    # Phase 13: 自動翻訳機能 (P13-02)。 service layer のみ (model なし)。
    "apps.translation",
    # Phase 14: Claude Agent (P14-01)。 AgentRun audit log + tool layer +
    # AgentRunner service。 spec: docs/specs/claude-agent-spec.md
    "apps.agents",
]

# --- Channels / Daphne (P3-02 / Issue #227) ---
# `daphne` は INSTALLED_APPS の **先頭** に置く必要がある (Twisted reactor を他の
# import より前に固定する。Daphne の AppConfig.ready() がそれを保証する)。
# `channels` も同様の理由で上位に置く。詳細:
# https://channels.readthedocs.io/en/stable/installation.html
CHANNELS_APPS = [
    "daphne",
    "channels",
]

INSTALLED_APPS = CHANNELS_APPS + DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # P0-10: inject request_id / user_id / path into structlog contextvars
    "apps.common.logging.RequestContextMiddleware",
]

# --- Structured logging (P0-10) ---
# structlog を標準 logging に噛ませる。ローカルは色付き ConsoleRenderer、
# stg/prod は JSONRenderer に切替える。詳細は apps/common/logging.py。
from apps.common.logging import build_logging_dict, configure_structlog  # noqa: E402

configure_structlog(SENTRY_ENVIRONMENT)
LOGGING = build_logging_dict(SENTRY_ENVIRONMENT)

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [str(APPS_DIR / "templates")],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# P3-13 で channels を導入したため、`channels` を INSTALLED_APPS に含めると
# `manage.py runserver` が ASGI モードに切替わり ASGI_APPLICATION の指定を要求する。
# stg / prod は daphne が直接 `config.asgi:application` を起動するため不要だが、
# local の runserver 互換のために明示する。
ASGI_APPLICATION = "config.asgi.application"

# drf-yasg の `generate_swagger` 管理コマンド向け。Info オブジェクトを import
# string で渡すことで server なしで schema を吐ける (人間向け /redoc/ UI 用)。
SWAGGER_SETTINGS = {
    "DEFAULT_INFO": "config.openapi.api_info",
}

# drf-spectacular: frontend codegen 用 OpenAPI 3.0 schema を吐くため。
# drf-yasg は APIView (非 ViewSet) で `action_map=None` で落ちるため、modern な
# drf-spectacular に schema 生成は寄せる (UI は redoc のままで OK)。
SPECTACULAR_SETTINGS = {
    "TITLE": "Alpha Apartments API",
    "DESCRIPTION": "エンジニア向け SNS API。Frontend codegen の source。",
    "VERSION": "v1",
    "SERVE_INCLUDE_SCHEMA": False,
    # 認証スキームは Cookie JWT。OpenAPI 上は明示しない (`/api/v1/auth/cookie/...`
    # 経由でブラウザが cookie 取得済前提)。
    "SCHEMA_PATH_PREFIX": "/api/v1/",
}


# Database
# https://docs.djangoproject.com/en/4.2/ref/settings/#databases

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": getenv("POSTGRES_DB"),
        "USER": getenv("POSTGRES_USER"),
        "PASSWORD": getenv("POSTGRES_PASSWORD"),
        "HOST": getenv("POSTGRES_HOST"),
        "PORT": getenv("POSTGRES_PORT"),
    }
}


# Password validation
# https://docs.djangoproject.com/en/4.2/ref/settings/#auth-password-validators

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.ScryptPasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]


# Internationalization
# https://docs.djangoproject.com/en/4.2/topics/i18n/

LANGUAGE_CODE = "ja"

TIME_ZONE = "Asia/Tokyo"

USE_I18N = True

USE_TZ = True

SITE_ID = 1


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/4.2/howto/static-files/

STATIC_URL = "/static/"

STATIC_ROOT = str(BASE_DIR / "staticfiles")

# Default primary key field type
# https://docs.djangoproject.com/en/4.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

TAGGIT_CASE_INSENSITIVE = True

AUTH_USER_MODEL = "users.User"

if USE_TZ:
    CELERY_TIMEZONE = TIME_ZONE

CELERY_BROKER_URL = getenv("CELERY_BROKER_URL")
CELERY_RESULT_BACKEND = getenv("CELERY_RESULT_BACKEND")
CELERY_ACCEPT_CONTENT = ["application/json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_RESULT_BACKEND_MAX_RETRIES = 10

CELERY_TASK_SEND_ENENT = True
CELERY_RESULT_EXTEND = True

CELERY_RESULT_BACKEND_ALWAYS_RETRY = True
CELERY_TASK_TIME_LIMIT = 5 * 60
CELERY_TASK_SOFT_TIME_LIMIT = 60
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"

CELERY_WORKERS_SEND_TASKS_EVENTS = True

# --- Django Channels (P3-02 / Issue #227) ---
# Phase 3 の DM real-time 配信で使用。Phase 4A 通知 / 将来の WebSocket 用途も同じ
# channel layer を共有する。
#
# REDIS_URL は Celery 用 (DB 0) と同じインスタンスを共有する想定。本番は ElastiCache
# (Multi-AZ replica 1) に向く。capacity=1500 は 1 group へのバッファ上限、expiry=60
# はメッセージの TTL 秒。共に Channels の defaults よりやや余裕を持たせた値。
#
# #275: stg の REDIS_URL は kombu/celery 互換のため `?ssl_cert_reqs=CERT_REQUIRED`
# (大文字文字列) を含む。channels_redis (= redis-py async 5.0.x) はこの URL の
# query を parse して `cert_reqs="CERT_REQUIRED"` を試行するが、redis-py が
# 期待するのは小文字の {"none", "optional", "required"} のみで、"CERT_REQUIRED"
# は invalid として `Invalid SSL Certificate Requirements Flag: CERT_REQUIRED`。
#
# 解決策: URL の query を strip して address だけ渡し、`ssl_cert_reqs` は dict
# 形式の host kwarg として **小文字 "required"** で明示する。redis-py 5.0.x の
# `RedisSSLContext` は文字列を内部で `ssl.CERT_REQUIRED` 等の constant に変換
# する (PR #279 1st attempt で int constant を直接渡したところ
# `'RedisSSLContext' object has no attribute 'cert_reqs'` の AttributeError で
# crash した、redis/asyncio/connection.py:RedisSSLContext.__init__ 参照)。
#
# celery / kombu は引き続き query 付き URL を直接使用 (parser が違うため影響なし)。
_redis_url_raw = getenv("REDIS_URL", "redis://redis:6379/0")
_redis_url_clean = re.sub(r"\?.*$", "", _redis_url_raw)
_channels_host: dict[str, object] = {"address": _redis_url_clean}
if _redis_url_clean.startswith("rediss://"):
    # ElastiCache はサーバ証明書が AWS 管理の CA で署名されているため verify する。
    # 小文字 "required" で渡すこと (大文字 "CERT_REQUIRED" や int constant は invalid)。
    _channels_host["ssl_cert_reqs"] = "required"

# #311: Django cache backend (P2-08 home TL cache 等の保存先).
# 旧設定は CACHES 未定義 = default LocMemCache だったため、gunicorn workers
# 間で cache が共有されず、worker A の `cache.delete(...)` が worker B に
# 伝播しなかった (post → 別 worker での GET が stale を返す原因)。
# REDIS_URL (Channels / Celery と同じ instance) を流用する。DB 分離より
# KEY_PREFIX で衝突回避する方がシンプル (django-cache: "sns:cache:*" /
# celery: "celery-task-meta-*" / channels: "asgi::*")。
_cache_options: dict[str, object] = {
    "CLIENT_CLASS": "django_redis.client.DefaultClient",
    "IGNORE_EXCEPTIONS": True,
}
if _redis_url_clean.startswith("rediss://"):
    _cache_options["CONNECTION_POOL_KWARGS"] = {"ssl_cert_reqs": "required"}

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": _redis_url_clean,
        "OPTIONS": _cache_options,
        "KEY_PREFIX": "sns:cache",
        "TIMEOUT": 300,
    }
}
# cache backend エラーで request が落ちないように (silent log のみ)。
DJANGO_REDIS_IGNORE_EXCEPTIONS = True
DJANGO_REDIS_LOG_IGNORED_EXCEPTIONS = True

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [_channels_host],
            "capacity": 1500,
            "expiry": 60,
        },
    },
}

# WebSocket は CSRF token を持たないため、``Origin`` ヘッダの allowlist が
# 唯一の cross-site 防御。production / stg / local で値を分離する。
# 環境変数 DJANGO_CHANNELS_ALLOWED_ORIGINS は CSV 形式
# ("https://stg.codeplace.me,http://localhost:8080")。空なら local 既定値を使う。
_raw_allowed_origins = getenv("DJANGO_CHANNELS_ALLOWED_ORIGINS", "")
if _raw_allowed_origins:
    CHANNELS_ALLOWED_ORIGINS = [
        origin.strip() for origin in _raw_allowed_origins.split(",") if origin.strip()
    ]
else:
    # local 開発用の既定値。stg/prod は env で必ず上書きする (下の fail-fast 参照)。
    CHANNELS_ALLOWED_ORIGINS = ["http://localhost:8080", "http://localhost:3000"]

if SENTRY_ENVIRONMENT in ("stg", "production") and not _raw_allowed_origins:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        f"DJANGO_CHANNELS_ALLOWED_ORIGINS must be set in {SENTRY_ENVIRONMENT} "
        "(WebSocket Origin allowlist; sec CRITICAL P3-02)."
    )

# P1-01 + ADR-0003: HttpOnly Cookie で JWT を運搬する設定。
# Secure は stg/prod で True、local では False (mailpit 等で HTTP 疎通用)。
#
# security-reviewer (PR #84) 指摘: stg/prod で COOKIE_SECURE が False のまま起動すると
# Cookie が HTTP でも送信され、セッション盗聴に繋がる。環境別に fail-fast させる。
COOKIE_NAME = "access"
# P1-12a + ADR-0003: refresh token も HttpOnly Cookie に載せる。access (COOKIE_NAME)
# とはキー名を分けることで、CookieTokenRefreshView が refresh のみを読み、他 API
# のリクエストに不必要な refresh cookie を送らない設計を取れる。
REFRESH_COOKIE_NAME = "refresh"
COOKIE_SAMESITE = "Lax"
COOKIE_PATH = "/"
COOKIE_HTTPONLY = True
COOKIE_SECURE = getenv("COOKIE_SECURE", "False").lower() == "true"
# #281 follow-up: stg/prod で wss を別 subdomain (ws.stg.codeplace.me) に分けたため、
# cookies を親 domain (.stg.codeplace.me) に設定して subdomain 間で共有する。
# 未設定 (= local) では cookie の domain は request host に固定される (subdomain
# 共有しない)。stg/prod では env で `.stg.codeplace.me` 等を設定すること。
COOKIE_DOMAIN: str | None = getenv("COOKIE_DOMAIN") or None

if SENTRY_ENVIRONMENT in ("stg", "production") and not COOKIE_SECURE:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        f"COOKIE_SECURE must be True in {SENTRY_ENVIRONMENT} — "
        "set env COOKIE_SECURE=True (ADR-0003)."
    )

# F1-5: Django 標準 Cookie の Secure フラグ。CSRF/Session Cookie は本来 SPA + Cookie
# JWT 構成で session を持たない設計だが、Django admin / djoser が session/CSRF を使う
# ため必須化する。COOKIE_SECURE と同じ env を共有してフラグの drift を防ぐ。
CSRF_COOKIE_SECURE = COOKIE_SECURE
SESSION_COOKIE_SECURE = COOKIE_SECURE
CSRF_COOKIE_HTTPONLY = False  # CSRF token は JS が読む必要があるので HttpOnly 不可
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"

# F1-6: CORS 設定。Next.js frontend からの cross-origin リクエストを許可。
# stg/prod では env CORS_ALLOWED_ORIGINS (カンマ区切り) を必須化。
# local では空のままで django-cors-headers の default 動作 (全 origin 拒否) になるが、
# DEBUG=True の場合は同一 origin (localhost:3000) 経由が前提なのでこれで OK。
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
]
CORS_ALLOW_CREDENTIALS = True  # HttpOnly Cookie で JWT を送るため必須

if SENTRY_ENVIRONMENT in ("stg", "production") and not CORS_ALLOWED_ORIGINS:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        f"CORS_ALLOWED_ORIGINS must be set in {SENTRY_ENVIRONMENT}. "
        "Pass a comma-separated list of allowed origins via env."
    )


# #336: stg では throttle rate を緩和する (DRF の SimpleRateThrottle は
# クラス import 時に api_settings.DEFAULT_THROTTLE_RATES を class attribute に
# copy するので、production.py で後付け上書きしても効かない既知の特性。
# REST_FRAMEWORK 初期定義時にここで分岐させる必要がある).
_IS_STG = SENTRY_ENVIRONMENT == "stg"
_THROTTLE_RATES_BASE = {
    "anon": "200/day" if not _IS_STG else "2000/day",
    "user": "500/day" if not _IS_STG else "5000/day",
    "post_tweet": "500/day" if not _IS_STG else "5000/day",
    "post_tweet_tier_1": "100/day" if not _IS_STG else "1000/day",
    "post_tweet_tier_2": "500/day" if not _IS_STG else "5000/day",
    "post_tweet_tier_3": "1000/day" if not _IS_STG else "10000/day",
    "reaction": "60/min" if not _IS_STG else "600/min",
    # 以下は abuse 防止が目的なので stg でも本番と同値に据え置く:
    "login": "5/minute",
    "avatar_upload": "10/minute",
    "tag_propose": "20/hour",
    "dm_attachment_presign": "30/hour",
    "dm_attachment_confirm": "30/hour",
    # Phase 5 boards (boards-spec §3.5):
    # - スレ作成 5 分に 1 件相当 = 12/hour
    # - レス投稿 30 秒に 1 件相当 = 120/hour
    # - 画像 presigned URL 30/hour
    "boards_thread_create": "12/hour" if not _IS_STG else "120/hour",
    "boards_post_create": "120/hour" if not _IS_STG else "1200/hour",
    "boards_image_presign": "30/hour" if not _IS_STG else "300/hour",
    # Phase 4B moderation (moderation-spec §4.4):
    # - block / mute は 30/hour (通常運用想定)
    # - report は 5/hour (スパム通報防止)
    "moderation_block": "30/hour" if not _IS_STG else "300/hour",
    "moderation_mute": "30/hour" if not _IS_STG else "300/hour",
    "moderation_report": "5/hour" if not _IS_STG else "50/hour",
    # Phase 6 articles (P6-03):
    # 30/hour = 2 分に 1 本ペース。長文記事の保存頻度を考えると十分余裕あり。
    "article_write": "30/hour" if not _IS_STG else "300/hour",
    # Phase 6 articles 画像アップロード (P6-04 / docs/specs/article-image-upload-spec.md):
    # 30/hour は記事 1 本に画像 10 枚貼っても 3 本/時 = 通常運用十分。
    "article_image_presign": "30/hour" if not _IS_STG else "300/hour",
    "article_image_confirm": "30/hour" if not _IS_STG else "300/hour",
    # Phase 12 user search (P12-04 / #676):
    # 共有 anon (200/day) は keystroke search で簡単に枯渇するので
    # /api/v1/users/search/ 専用の per-minute scope を切る。
    # 60/min = SearchBox を 1 秒間隔で叩いても 1 分は持つ余裕。 bot 抑止としても十分。
    "user_search_anon": "60/min" if not _IS_STG else "600/min",
    # Phase 13 P13-03 (auto-translate-spec §5.2 / §6):
    # POST /api/v1/tweets/<id>/translate/ は OpenAI 課金が発生するので
    # 1 ユーザー 60 翻訳/時間に制限 (= 1 分に 1 件ペース)。
    # TL を眺めながら数件押す通常 UX に十分な余裕、 cache hit は OpenAI を叩かないので
    # 同一ツイートを繰り返し押しても枠は消費しない (cache miss だけがコスト要因)。
    "translate": "60/hour" if not _IS_STG else "600/hour",
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "apps.common.cookie_auth.CookieAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    # drf-spectacular に schema 生成を寄せる (OpenAPI 3.0)。drf-yasg の `redoc/`
    # UI は依然動く (drf-yasg は内部で coreapi schema 経由)。frontend codegen は
    # /api/schema/ → openapi-typescript で生成。
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],
    "PAGE_SIZE": 10,
    # P1-01 + SPEC §14.5: スパム検知階層を意識した throttle 設定。
    # user_default は既定の 500/day、post_tweet は P1-08 で ScopedRateThrottle として
    # 個別使用し SPEC §14.5 の階層 (100/500/1000 /day) をアラート側 Celery Beat で検知する。
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    # P1-11 (#97) + SPEC §14.5 + #336: 階層 throttle の rate 定義。
    # 値は上の `_THROTTLE_RATES_BASE` で stg 環境分岐済み。
    # 実際に階層を切り替える責務は ``apps.common.throttling.PostTweetThrottle``。
    # このマップは DRF が scope 名から rate を引くだけのテーブルに徹する。
    "DEFAULT_THROTTLE_RATES": _THROTTLE_RATES_BASE,
}

# P2-07 (sec CRITICAL #1): OGP fetch の User-Agent. 環境変数で override 可能。
OGP_USER_AGENT = getenv("OGP_USER_AGENT", "SNS-OGP-Bot/1.0")

# P1-01 + ADR-0003 準拠:
# - ALGORITHM              : HS256 を明示 (security-reviewer PR #84 指摘)
# - ACCESS_TOKEN_LIFETIME  : 60 min (SPEC §1.3 に合わせる、旧 30 分からアップ)
# - REFRESH_TOKEN_LIFETIME : 14 days (SPEC §1.3 に合わせる、旧 1 day からアップ)
# - ROTATE_REFRESH_TOKENS  : 継続使用時は自動ローテ、切断後は再ログイン
# - BLACKLIST_AFTER_ROTATION: ローテ後の旧 refresh を blacklist 追加して再利用拒否
#
# code-reviewer (PR #131 MEDIUM #5) 指摘:
#   SIGNING_KEY が None fallback されていた (getenv("SIGNING_KEY") が None になると
#   simplejwt は内部で SECRET_KEY を使う側に倒れるが、これは「prod で SIGNING_KEY を
#   設定し忘れた」事故を検出できない)。stg/production では env 未設定なら起動時に
#   ImproperlyConfigured を投げる (fail-fast)。local のみ SECRET_KEY fallback を
#   明示的に許容する。
_signing_key = getenv("SIGNING_KEY")
if SENTRY_ENVIRONMENT in ("stg", "production") and not _signing_key:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured("SIGNING_KEY env var must be set in stg/production (ADR-0003).")

# local では DJANGO_SECRET_KEY に fallback することを明示する。SECRET_KEY 自体は
# 環境別 settings (local.py / stg.py / production.py) で定義されるため、ここでは
# 環境変数から直接取得して fallback を評価する (base.py 単独インポートでも不整合なし)。
# simplejwt は未指定なら settings.SECRET_KEY に自動 fallback するが、「local のみ
# fallback が発生する」ことを明示的な値で示すために DJANGO_SECRET_KEY からも拾う。
# 空値のときは dict から SIGNING_KEY キー自体を省き、simplejwt の default
# (settings.SECRET_KEY) を使わせる。
_signing_key_fallback = _signing_key or getenv("DJANGO_SECRET_KEY") or None

SIMPLE_JWT = {
    "ALGORITHM": "HS256",
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=14),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "AUTH_HEADER_TYPES": ("Bearer",),
}
if _signing_key_fallback:
    # truthy 値のときだけ明示する。空のときは simplejwt の default (settings.SECRET_KEY)
    # をそのまま使わせる (None を書き込むと encoding が壊れるため)。
    SIMPLE_JWT["SIGNING_KEY"] = _signing_key_fallback

DJOSER = {
    "USER_ID_FIELD": "id",
    "LOGIN_FIELD": "email",
    "DOMAIN": getenv("DOMAIN"),
    "TOKEN_MODEL": None,
    "USER_CREATE_PASSWORD_RETYPE": True,
    "SEND_ACTIVATION_EMAIL": True,
    "PASSWORD_CHANGED_EMAIL_CONFIRMATION": True,
    "PASSWORD_RESET_CONFIRM_RETYPE": True,
    "ACTIVATION_URL": "activate/{uid}/{token}",
    "PASSWORD_RESET_CONFIRM_URL": "password-reset/{uid}/{token}",
    "SERIALIZERS": {
        "user_create": "apps.users.serializers.CreateUserSerializer",
        "current_user": "apps.users.serializers.CustomUserSerializer",
    },
}


AUTHENTICATION_BACKENDS = [
    # P1-01 + P1-12: Google OAuth。`social-auth-app-django` の backend を追加して
    # social auth pipeline を使用可能に。ModelBackend は email + password 経由
    # (djoser + P1-12a) で引き続き使う。
    "social_core.backends.google.GoogleOAuth2",
    "django.contrib.auth.backends.ModelBackend",
]

# P1-01 + P1-12: social-auth-app-django (Google OAuth2) 設定
SOCIAL_AUTH_GOOGLE_OAUTH2_KEY = getenv("GOOGLE_OAUTH_CLIENT_ID", "")
SOCIAL_AUTH_GOOGLE_OAUTH2_SECRET = getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
SOCIAL_AUTH_GOOGLE_OAUTH2_SCOPE = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
]
SOCIAL_AUTH_USER_MODEL = AUTH_USER_MODEL
SOCIAL_AUTH_JSONFIELD_ENABLED = True
# pipeline は P1-12 で JWT 発行ステップを挿入するため先に定義しておく。
#
# security-reviewer (PR #84) 指摘: `associate_by_email` はアカウント乗っ取りリスクが
# あるため含めない。Google OAuth 経由でログインする際、email 一致だけで既存
# ローカル (djoser) アカウントに紐付けると、攻撃者が他人のメールを使った Google
# アカウントを作成することで侵入できてしまう。
#
# 代わりに:
#   - 新規 Google ユーザーは `create_user` で新規作成
#   - 既存ユーザーへの Google 連携は P1-12a で「ログイン済みユーザーが明示的に
#     リンクする」フローを別途実装する (settings 画面 → OAuth 開始)
SOCIAL_AUTH_PIPELINE = (
    "social_core.pipeline.social_auth.social_details",
    "social_core.pipeline.social_auth.social_uid",
    "social_core.pipeline.social_auth.auth_allowed",
    "social_core.pipeline.social_auth.social_user",
    "social_core.pipeline.user.get_username",
    # "social_core.pipeline.social_auth.associate_by_email",  # account takeover risk — intentionally omitted
    "social_core.pipeline.user.create_user",
    "social_core.pipeline.social_auth.associate_user",
    "social_core.pipeline.social_auth.load_extra_data",
    "social_core.pipeline.user.user_details",
    # P1-12: 新規ユーザーに needs_onboarding=True を明示的に設定 (SPEC §1.2)。
    # User モデルの default が将来変わっても onboarding flow が確実に起動するよう
    # pipeline 内で立てる。既存ユーザーには干渉しない (is_new=True のみ動作)。
    "apps.users.social_pipeline.set_needs_onboarding",
)

# code-reviewer (PR #138 LOW) 指摘対応:
#   djoser の ``ProviderAuthSerializer`` は ``redirect_uri`` を受け取り、
#   ``SOCIAL_AUTH_ALLOWED_REDIRECT_URIS`` 内に含まれるもののみ許可する。
#   明示的に登録することで、任意 URL への redirect 漏洩 (open redirect) を
#   防止する。local は localhost:3000 を既定値、stg/prod は env で frontend
#   URL を上書きする。
SOCIAL_AUTH_ALLOWED_REDIRECT_URIS = [
    getenv("SOCIAL_AUTH_ALLOWED_REDIRECT_URI", "http://localhost:3000/auth/google"),
]

# ---------------------------------------------------------------------------
# P1-01 + ADR-0003: S3 / django-storages 設定。AWS_S3_BUCKET_NAME が空なら
# local の FileSystemStorage にフォールバックする。
# ---------------------------------------------------------------------------

AWS_ACCESS_KEY_ID = getenv("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = getenv("AWS_SECRET_ACCESS_KEY", "")
AWS_S3_REGION_NAME = getenv("AWS_S3_REGION_NAME", "ap-northeast-1")
AWS_STORAGE_BUCKET_NAME = getenv("AWS_STORAGE_BUCKET_NAME", "")
AWS_S3_CUSTOM_DOMAIN = getenv("AWS_S3_CUSTOM_DOMAIN", "")

# Issue #458: DM 添付の絶対 URL を組み立てるための base (CloudFront 配信ドメイン)。
# `MessageAttachmentSerializer.get_url` で `<base>/<s3_key>` を組む。CloudFront の
# `/dm/*` path-pattern behavior が S3 media origin に振っている前提。
# 例:
#   - local: http://localhost:8080
#   - stg:   https://stg.codeplace.me
#   - prod:  https://<prod_domain>
DM_ATTACHMENT_BASE_URL = getenv("DM_ATTACHMENT_BASE_URL", "")
AWS_DEFAULT_ACL = None  # BucketOwnerEnforced と整合 (ACL 無効化)
AWS_S3_FILE_OVERWRITE = False  # 同名ファイルは自動で suffix 付け
AWS_S3_SIGNATURE_VERSION = "s3v4"
AWS_S3_ADDRESSING_STYLE = "virtual"
AWS_S3_OBJECT_PARAMETERS = {
    "CacheControl": "max-age=86400",  # 1 day; CloudFront が前段なのでここは長め OK
}

# code-reviewer (PR #139 HIGH #2) 指摘: avatar_url / header_url を PATCH で自由に
# 書き換えられると SSRF / phishing / tracking pixel 化 (例: https://evil.com/track.jpg)
# のリスクがある。サーバー側で「許可された S3 / CloudFront ドメインのみ」を white list
# として enforce する。空要素は list comprehension で除外して local 開発
# (AWS_STORAGE_BUCKET_NAME 未設定) では実質 no-op になる。
ALLOWED_MEDIA_DOMAINS = [
    AWS_S3_CUSTOM_DOMAIN,  # CloudFront カスタムドメイン
    f"{AWS_STORAGE_BUCKET_NAME}.s3.{AWS_S3_REGION_NAME}.amazonaws.com"
    if AWS_STORAGE_BUCKET_NAME
    else "",  # S3 virtual-host 形式
]
ALLOWED_MEDIA_DOMAINS = [d for d in ALLOWED_MEDIA_DOMAINS if d]  # 空要素除外

# Django 4.2 STORAGES 設定: 新しい storages API
# https://docs.djangoproject.com/en/4.2/ref/settings/#storages
_use_s3 = bool(AWS_STORAGE_BUCKET_NAME)
STORAGES = {
    "default": {
        "BACKEND": (
            "storages.backends.s3.S3Storage"
            if _use_s3
            else "django.core.files.storage.FileSystemStorage"
        ),
        "OPTIONS": (
            {
                "bucket_name": AWS_STORAGE_BUCKET_NAME,
                "custom_domain": AWS_S3_CUSTOM_DOMAIN or None,
                "location": "media",
            }
            if _use_s3
            else {}
        ),
    },
    "staticfiles": {
        # static は CloudFront + S3 (別バケット) から配信。Phase 0.5-08 の
        # sns-stg-static に collectstatic で push。ローカルは FS に fallback。
        "BACKEND": (
            "storages.backends.s3.S3Storage"
            if _use_s3
            else "django.contrib.staticfiles.storage.StaticFilesStorage"
        ),
        "OPTIONS": (
            {
                "bucket_name": getenv("AWS_STATIC_BUCKET_NAME", ""),
                "custom_domain": getenv("AWS_S3_STATIC_CUSTOM_DOMAIN", "") or None,
                "location": "static",
                # #439: custom_domain (CloudFront) 経由で配信する場合は presigned
                # URL ではなくクリーン URL を生成させる。querystring_auth=True
                # (default) のままだと <link href="https://<bucket>.s3...?X-Amz-..."> と
                # S3 直 URL を出してしまい、CloudFront の /static/* path-pattern
                # behavior をすり抜けて OAC で 403 になる。
                "querystring_auth": False,
            }
            if _use_s3 and getenv("AWS_STATIC_BUCKET_NAME")
            else {}
        ),
    },
}

# ---------------------------------------------------------------------------
# P1-01 + SPEC §3: Markdown 描画 (markdown2 + bleach の共通設定)
# 実際のレンダリング関数は P1-09 で apps/tweets/rendering.py に実装。
# ---------------------------------------------------------------------------

MARKDOWN_BLEACH_ALLOWED_TAGS = [
    "a",
    "abbr",
    "acronym",
    "b",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "img",
    "kbd",
    "li",
    "ol",
    "p",
    "pre",
    "q",
    "s",
    "small",
    "span",
    "strike",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "ul",
    "div",  # div はシンタックスハイライトのラッパ用
]
# security-reviewer (PR #84) 指摘: `*` ワイルドカードで全タグに class/id を許可すると
# XSS 経由のクラス衝突 (例: admin ボタンと同じ class 名で UI を欺瞞) を許してしまう。
# シンタックスハイライト / コードブロック / コラプス用 div に限定して class を個別許可。
MARKDOWN_BLEACH_ALLOWED_ATTRS = {
    "a": ["href", "title", "target", "rel"],
    "img": ["src", "alt", "title", "width", "height", "loading"],
    "code": ["class"],  # e.g. language-python (Shiki 用)
    "pre": ["class"],
    # security-reviewer (PR #134) 指摘: Shiki のシンタックスハイライト span は
    # クライアント側の JS が描画する (サーバー入力ではない) ため、サーバー側の
    # bleach allowlist に ``span[class]`` を残しておく必要はない。
    # クラス衝突による UI 欺瞞 (例: admin-only bedge クラスを悪用) のリスクを
    # 避けるため、ここからは削除する。
    "div": ["class"],  # シンタックスハイライトのラッパ (highlight 等)
}
MARKDOWN_BLEACH_ALLOWED_PROTOCOLS = ["http", "https", "mailto"]  # javascript: を弾く


# ---------------------------------------------------------------------------
# Phase 13 P13-02: 自動翻訳機能 (OpenAI GPT-4o-mini)
# ---------------------------------------------------------------------------
# 空のときは apps.translation.services.get_translator() が NoopTranslator
# (原文返却 stub) に fallback するので、 local / CI でも 500 にならない設計。
# stg / prod は AWS Secrets Manager 経由で ECS task に inject (P13-08 issue 参照)。
OPENAI_API_KEY = getenv("OPENAI_API_KEY", "")


# ---------------------------------------------------------------------------
# Phase 14 P14-03: Claude Agent (Read+Compose MVP)
# ---------------------------------------------------------------------------
# 空のときは AgentRunner が AgentDisabledError を raise → view 側で 503。
# stg / prod は P14-07 で terraform から ECS task secrets 経由で inject。
ANTHROPIC_API_KEY = getenv("ANTHROPIC_API_KEY", "")
