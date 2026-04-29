"""Postgres extension migration (P2-02 / GitHub #177).

`pg_bigm` と `pg_trgm` を有効化する。両 extension は app 単位ではなく DB 単位で
有効化されるので、共有 migration として apps/common 配下に置く。

注意:
- `pg_bigm` は外部 extension のため、Postgres image にあらかじめ
  `postgresql-XX-pg-bigm` が apt install されている必要がある。
  - ローカル / stg / prod: `docker/local/postgres/Dockerfile` および
    `docker/production/postgres/Dockerfile` で対応。
  - RDS: parameter group `shared_preload_libraries = pg_bigm,pg_stat_statements`
    が Phase 0.5 で設定済み。本 migration を走らせるだけで extension が有効化される。
- `pg_trgm` は標準 contrib モジュールなので、どの Postgres image でも利用可能。
- migration は冪等 (`CREATE EXTENSION IF NOT EXISTS`) なので再実行しても問題ない。

F-15 (`docs/issues/phase-0.5-followups.md`) を本 migration で内包・close する。
"""

from __future__ import annotations

from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    initial = True
    dependencies: list[tuple[str, str]] = []
    operations = [
        # `CreateExtension("pg_bigm")` は Django 標準の操作。`schema_editor` が
        # `CREATE EXTENSION IF NOT EXISTS pg_bigm` を発行する。
        migrations.RunSQL(
            sql="CREATE EXTENSION IF NOT EXISTS pg_bigm;",
            reverse_sql="DROP EXTENSION IF EXISTS pg_bigm;",
            # `state_operations=[]` で Django state には何も追加しない (RDB 構造のみ変更)。
            state_operations=[],
        ),
        TrigramExtension(),
    ]
