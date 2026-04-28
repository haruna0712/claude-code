FROM docker.io/postgres:16-bullseye

# 本番は RDS を使うため通常このイメージは使われないが、ローカル動作確認や
# 緊急時の self-hosted DB 立ち上げに備えて pg_bigm を同梱しておく (P2-02)。
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgdg-pg-bigm \
    && rm -rf /var/lib/apt/lists/*
