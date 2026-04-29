from os import getenv, path

from dotenv import load_dotenv

from .base import *
from .base import BASE_DIR

local_env_file = path.join(BASE_DIR, ".envs", ".env.local")

if path.isfile(local_env_file):
    load_dotenv(local_env_file)

DEBUG = True

SITE_NAME = getenv("SITE_NAME")

SECRET_KEY = getenv("DJANGO_SECRET_KEY", "3vCSsfZQt6yXcbDrKW46_RGBG2Hpan3gZux3hnerg8oHKp9mNfw")

# stg/勉強用 ECS デプロイで local.py を使う場合に Host / Origin ヘッダ問題を回避するため、
# 環境変数からの override を許す。env が空なら従来のローカル開発専用デフォルトを維持。
_env_hosts = getenv("ALLOWED_HOSTS", "").strip()
if _env_hosts:
    ALLOWED_HOSTS = [h.strip() for h in _env_hosts.split(",") if h.strip()]
    # ALB の health check が ALB DNS や ELB internal name で叩くため一律許可。
    if ".elb.amazonaws.com" not in ALLOWED_HOSTS:
        ALLOWED_HOSTS.append(".elb.amazonaws.com")
else:
    ALLOWED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0"]

_env_origins = getenv("CORS_ALLOWED_ORIGINS", "").strip()
if _env_origins:
    CSRF_TRUSTED_ORIGINS = [o.strip() for o in _env_origins.split(",") if o.strip()]
else:
    CSRF_TRUSTED_ORIGINS = ["http://localhost:8080"]

ADMIN_URL = getenv("DJANGO_ADMIN_URL")
EMAIL_BACKEND = "djcelery_email.backends.CeleryEmailBackend"
EMAIL_HOST = getenv("EMAIL_HOST")
EMAIL_PORT = getenv("EMAIL_PORT")
DEFAULT_FROM_EMAIL = getenv("DEFAULT_FROM_EMAIL")
DOMAIN = getenv("DOMAIN")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "%(levelname)s %(name)-12s %(asctime)s %(module)s %(process)d %(thread)d %(message)s"
        }
    },
    "handlers": {
        "console": {
            "level": "DEBUG",
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        }
    },
    "root": {"level": "INFO", "handlers": ["console"]},
}
