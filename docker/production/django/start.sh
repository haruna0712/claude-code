#!/bin/bash

set -o errexit
set -o pipefail
set -o nounset

# #291: migrate は cd-stg.yml の "Run Django migrations on ECS" step が
# sns-stg-django-migrate task で実施する。container 起動時に重複実行すると
# 多重起動レース + cold start を遅らせて healthcheck flapping を引き起こす
# ため削除した。local 開発環境は docker compose の別 service / `manage.py
# migrate` で個別に管理する。
python /app/manage.py collectstatic --noinput

NUM_WORKERS=${GUNICORN_WORKERS:-3}
GUNICORN_TIMEOUT=${GUNICORN_TIMEOUT:-60}
GUNICORN_GRACEFUL_TIMEOUT=${GUNICORN_GRACEFUL_TIMEOUT:-30}

# #291: --preload で fork 前に app を import し、worker 起動時の Aurora cold
# connect を 1 回に集約する (起動時間短縮)。--timeout 60 は default 30 より
# 緩く取って Aurora cold connect (~2s) や migration 直後の重い query を許容。
exec /usr/local/bin/gunicorn config.wsgi \
  --bind 0.0.0.0:8000 \
  --chdir=/app \
  --workers "$NUM_WORKERS" \
  --timeout "$GUNICORN_TIMEOUT" \
  --graceful-timeout "$GUNICORN_GRACEFUL_TIMEOUT" \
  --preload
