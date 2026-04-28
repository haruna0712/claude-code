FROM docker.io/postgres:16-bullseye

# P2-02: 日本語 N-gram 全文検索用に pg_bigm を apt install。
# pg_trgm は contrib に同梱されているのでここでは何もしない。
# postgresql-16-pgdg-pg-bigm は PGDG リポジトリ経由で配布される。
# Bullseye の base image には PGDG apt repo が事前設定されているため、追加 source.list は不要。
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgdg-pg-bigm \
    && rm -rf /var/lib/apt/lists/*
