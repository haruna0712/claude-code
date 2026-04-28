"""Add followers_count / following_count to User (P2-03 / GitHub #178).

Phase 2 の Follow signals がカウンタを atomic 更新するための denormalized
カラム。default=0 で追加するため既存 row への影響は無い。
reconciliation Beat (`apps.follows.tasks.reconcile_counters`) が日次で drift
を検出・補正する設計のため、本マイグレーションで初期値が 0 でも問題ない。
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0003_add_validate_media_url"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="followers_count",
            field=models.PositiveIntegerField(
                default=0,
                help_text=(
                    "Number of users following this user "
                    "(denormalized via Follow signals)."
                ),
                verbose_name="Followers Count",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="following_count",
            field=models.PositiveIntegerField(
                default=0,
                help_text="Number of users this user follows.",
                verbose_name="Following Count",
            ),
        ),
    ]
