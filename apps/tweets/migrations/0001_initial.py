"""P1-07: tweets 初期マイグレーション。

サンドボックスでは実 DB 起動ができないため手書き。
`apps.tags` の初期マイグレーションが merge されていない worktree では
このマイグレーションは流れないが、`apps.tags` 担当 worktree のマージ後に
通る想定で書いている。
"""

from __future__ import annotations

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("tags", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="Tweet",
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
                ("body", models.TextField(max_length=180)),
                ("is_deleted", models.BooleanField(default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("edit_count", models.PositiveSmallIntegerField(default=0)),
                ("last_edited_at", models.DateTimeField(blank=True, null=True)),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="tweets",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.CreateModel(
            name="TweetTag",
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
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "tag",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        to="tags.tag",
                    ),
                ),
                (
                    "tweet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="tweets.tweet",
                    ),
                ),
            ],
            options={
                "unique_together": {("tweet", "tag")},
            },
        ),
        migrations.AddField(
            model_name="tweet",
            name="tags",
            field=models.ManyToManyField(
                related_name="tweets",
                through="tweets.TweetTag",
                to="tags.tag",
            ),
        ),
        migrations.CreateModel(
            name="TweetImage",
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
                ("image_url", models.CharField(max_length=512)),
                ("width", models.PositiveIntegerField()),
                ("height", models.PositiveIntegerField()),
                ("order", models.PositiveSmallIntegerField(default=0)),
                (
                    "tweet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="images",
                        to="tweets.tweet",
                    ),
                ),
            ],
            options={
                "ordering": ["order"],
                "unique_together": {("tweet", "order")},
            },
        ),
        migrations.CreateModel(
            name="TweetEdit",
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
                ("body_before", models.TextField()),
                ("body_after", models.TextField()),
                ("edited_at", models.DateTimeField(auto_now_add=True)),
                (
                    "editor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "tweet",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="edits",
                        to="tweets.tweet",
                    ),
                ),
            ],
            options={
                "ordering": ["-edited_at"],
            },
        ),
        migrations.AddIndex(
            model_name="tweet",
            index=models.Index(fields=["-created_at"], name="tweets_twee_created_a8e7a3_idx"),
        ),
        migrations.AddIndex(
            model_name="tweet",
            index=models.Index(
                fields=["author", "-created_at"],
                name="tweets_twee_author__2d9c21_idx",
            ),
        ),
    ]
