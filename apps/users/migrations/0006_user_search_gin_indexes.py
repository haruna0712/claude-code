"""Add pg_trgm GIN indexes for user full-text search (P12-04).

``UserFullTextSearchView`` (``GET /api/v1/users/search/``) does
``Q(username__icontains=q) | Q(display_name__icontains=q) | Q(bio__icontains=q)``.
Without trigram indexes, ``ILIKE '%q%'`` falls back to a sequential scan on
three VARCHAR columns of the user table — slow as the user base grows.

``pg_trgm`` extension is already enabled by ``apps.common.migrations.0001_extensions``
(``TrigramExtension``), so this migration only adds the three ``gin_trgm_ops``
indexes via raw SQL. Raw SQL is used (vs ``GinIndex`` in ``Meta.indexes``) to
keep this migration self-contained — the indexes are pure performance and don't
need to round-trip through model state (``makemigrations`` won't auto-detect or
remove them since the model state knows nothing about them).

python-reviewer (P12-04) HIGH 指摘の修正。
"""

from __future__ import annotations

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0005_user_residence"),
        ("common", "0001_extensions"),
    ]

    operations = [
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS user_username_trgm_gin "
                'ON users_user USING gin ("username" gin_trgm_ops);'
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS user_username_trgm_gin;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS user_disp_name_trgm_gin "
                'ON users_user USING gin ("display_name" gin_trgm_ops);'
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS user_disp_name_trgm_gin;"
            ),
        ),
        migrations.RunSQL(
            sql=(
                "CREATE INDEX IF NOT EXISTS user_bio_trgm_gin "
                'ON users_user USING gin ("bio" gin_trgm_ops);'
            ),
            reverse_sql=(
                "DROP INDEX IF EXISTS user_bio_trgm_gin;"
            ),
        ),
    ]
