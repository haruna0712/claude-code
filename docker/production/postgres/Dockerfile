FROM docker.io/postgres:16-bullseye

# 本番は RDS を使うため通常このイメージは使われないが、ローカル動作確認や
# 緊急時の self-hosted DB 立ち上げに備えて pg_bigm を同梱しておく (P2-02)。
# 当初 PGDG apt 経由で入れる想定だったが該当パッケージが repo に無かったため
# upstream tarball から source build する方式に変更。
# 詳細: docker/local/postgres/Dockerfile に同じパターン。
ARG PG_BIGM_VERSION=1.2-20240606
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        postgresql-server-dev-16 \
        ca-certificates \
        wget \
    && wget -O /tmp/pg_bigm.tar.gz \
        "https://github.com/pgbigm/pg_bigm/archive/refs/tags/v${PG_BIGM_VERSION}.tar.gz" \
    && tar -xzf /tmp/pg_bigm.tar.gz -C /tmp \
    && cd "/tmp/pg_bigm-${PG_BIGM_VERSION}" \
    && make USE_PGXS=1 \
    && make USE_PGXS=1 install \
    && cd / && rm -rf /tmp/pg_bigm.tar.gz "/tmp/pg_bigm-${PG_BIGM_VERSION}" \
    && apt-get purge -y build-essential postgresql-server-dev-16 wget \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
