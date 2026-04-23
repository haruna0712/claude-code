"""Initial migration for the tags app (P1-05).

手書き migration: サンドボックス環境で DB が動かないため、
`makemigrations` による自動生成ではなく手で作成している.
スキーマは apps/tags/models.py::Tag と 1:1 で対応する.
"""

from __future__ import annotations

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Tag",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "name",
                    models.CharField(
                        help_text="Lowercase unique slug. Normalized on save.",
                        max_length=50,
                        unique=True,
                        verbose_name="tag name (lowercase slug)",
                    ),
                ),
                (
                    "display_name",
                    models.CharField(
                        help_text=(
                            "Human-readable display form "
                            "(mixed case allowed, e.g. 'TypeScript')."
                        ),
                        max_length=50,
                        verbose_name="display name",
                    ),
                ),
                (
                    "description",
                    models.TextField(
                        blank=True,
                        help_text="Optional description curated by moderators.",
                        verbose_name="description",
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "is_approved",
                    models.BooleanField(
                        default=False,
                        help_text="Whether a moderator has approved this tag for public use.",
                        verbose_name="is approved",
                    ),
                ),
                (
                    "usage_count",
                    models.PositiveIntegerField(
                        default=0,
                        help_text=(
                            "Number of tweets referencing this tag "
                            "(cached, updated by P1-07)."
                        ),
                        verbose_name="usage count",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        help_text=(
                            "User who first proposed the tag. "
                            "NULL for system-seeded tags."
                        ),
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="proposed_tags",
                        to=settings.AUTH_USER_MODEL,
                        verbose_name="created by",
                    ),
                ),
            ],
            options={
                "verbose_name": "Tag",
                "verbose_name_plural": "Tags",
                "ordering": ["-usage_count", "name"],
            },
        ),
        migrations.AddIndex(
            model_name="tag",
            index=models.Index(fields=["name"], name="tags_tag_name_idx"),
        ),
        migrations.AddIndex(
            model_name="tag",
            index=models.Index(fields=["-usage_count"], name="tags_tag_usage_idx"),
        ),
    ]
