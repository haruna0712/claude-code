"""Production / stg settings module.

Loaded by ECS task definitions via DJANGO_SETTINGS_MODULE=config.settings.production.
全ての secret / endpoint は env vars 経由 (services モジュールが ECS task definition の
secrets / environment ブロックで注入する)。

base.py との差分:
- DEBUG=False
- ALLOWED_HOSTS は env DOMAIN から組み立て
- CSRF_TRUSTED_ORIGINS は env CORS_ALLOWED_ORIGINS から組み立て
- SECRET_KEY は env DJANGO_SECRET_KEY (必須、未設定で fail-fast)
"""

from os import getenv

from .base import *

DEBUG = False

# F1-5/F1-6: Cookie / CORS の secure flag は base.py 側で env COOKIE_SECURE /
# CORS_ALLOWED_ORIGINS から読まれる (stg/prod は fail-fast)。production.py で
# 重ねて設定する必要なし。

SECRET_KEY = getenv("DJANGO_SECRET_KEY")
if not SECRET_KEY:
    from django.core.exceptions import ImproperlyConfigured

    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY must be set in stg/production. "
        "ECS task definition の secrets ブロックから注入されているか確認すること。"
    )

DOMAIN = getenv("DOMAIN", "localhost")
SITE_NAME = getenv("SITE_NAME", "SNS")

# ALB 経由の health check + ホスト名アクセスを許可。
# ALB の DNS 名 (*.elb.amazonaws.com) と app の domain 両方を許可。
ALLOWED_HOSTS = [
    DOMAIN,
    f".{DOMAIN}",  # サブドメイン (webhook.* 等) も許可
    "localhost",  # ALB target group health check
    "127.0.0.1",
]
# ALB の Direct DNS (DNS 委任前の暫定アクセス) を許可
_alb_dns = getenv("ALB_DNS_NAME", "")
if _alb_dns:
    ALLOWED_HOSTS.append(_alb_dns)
# 一律 *.elb.amazonaws.com を許可するのは health check のため (ALB が internal Host: で叩く)
ALLOWED_HOSTS.append(".elb.amazonaws.com")

CSRF_TRUSTED_ORIGINS = [
    o.strip() for o in getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
]
# 暫定 ALB 直アクセス用にも追加
if _alb_dns:
    CSRF_TRUSTED_ORIGINS.append(f"http://{_alb_dns}")
    CSRF_TRUSTED_ORIGINS.append(f"https://{_alb_dns}")

ADMIN_URL = getenv("DJANGO_ADMIN_URL", "admin/")

# Email: Mailgun 経由 (Phase 1 〜)。
EMAIL_BACKEND = "djcelery_email.backends.CeleryEmailBackend"
EMAIL_HOST = getenv("EMAIL_HOST", "smtp.mailgun.org")
EMAIL_PORT = int(getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = getenv("MAILGUN_API_KEY", "")
DEFAULT_FROM_EMAIL = getenv("DEFAULT_FROM_EMAIL", f"noreply@{DOMAIN}")

# Static files: S3 (django-storages) で配信予定。当面は CloudFront / ALB が
# 配信するため STATIC_URL のみ調整。
STATIC_URL = "/static/"

# Logging: stg/prod は structlog の JSONRenderer (base.py で env=stg/production
# のとき自動切替)。CloudWatch Logs に JSON 行で出る前提。

# #336: stg 限定の throttle 緩和は base.py の _THROTTLE_RATES_BASE で初期
# 定義時に分岐させる方針に変更 (DRF SimpleRateThrottle の class-level
# THROTTLE_RATES が import 時に固定されるため、production.py での後付け
# override は無効だった)。本ファイルでは throttle 関連 override は行わない。
