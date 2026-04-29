FROM docker.io/postgres:16-bullseye

# P2-02: 日本語 N-gram 全文検索用に pg_bigm を source build で入れる。
# 当初 `postgresql-16-pgdg-pg-bigm` を apt 経由で入れる想定だったが、PGDG 公式
# repo にこのパッケージは存在しなかった (CI が apt で `Unable to locate package`
# で失敗)。pg_bigm は upstream (pgbigm/pg_bigm) から git + make で入れるのが
# 公式手順なのでそれに合わせる。
# pg_trgm は contrib に同梱なので追加作業不要。
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
