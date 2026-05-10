# Generated for #524 (Phase 6 P6-01 articles). Manual migration matching apps/articles/models.py.

import uuid

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
            name="Article",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("slug", models.SlugField(max_length=120, unique=True)),
                ("title", models.CharField(max_length=120)),
                ("body_markdown", models.TextField()),
                ("body_html", models.TextField(blank=True)),
                (
                    "status",
                    models.CharField(
                        choices=[("draft", "下書き"), ("published", "公開済")],
                        default="draft",
                        max_length=16,
                    ),
                ),
                ("published_at", models.DateTimeField(blank=True, null=True)),
                ("view_count", models.PositiveIntegerField(default=0)),
                ("is_deleted", models.BooleanField(default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="articles",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-published_at", "-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="article",
            index=models.Index(
                condition=models.Q(("status", "published"), ("is_deleted", False)),
                fields=["-published_at"],
                name="articles_published_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="article",
            index=models.Index(
                fields=["author", "-updated_at"], name="articles_a_author__a3f7b1_idx"
            ),
        ),
        migrations.CreateModel(
            name="ArticleTag",
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
                ("sort_order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "article",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="article_tags",
                        to="articles.article",
                    ),
                ),
                (
                    "tag",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="article_tags",
                        to="tags.tag",
                    ),
                ),
            ],
            options={
                "ordering": ["sort_order", "created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="articletag",
            index=models.Index(
                fields=["tag", "-created_at"], name="articles_a_tag_id_b8c4e2_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="articletag",
            constraint=models.UniqueConstraint(
                fields=("article", "tag"), name="uniq_article_tag"
            ),
        ),
        migrations.CreateModel(
            name="ArticleImage",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("s3_key", models.CharField(max_length=512, unique=True)),
                ("url", models.URLField(max_length=1024)),
                ("width", models.PositiveIntegerField()),
                ("height", models.PositiveIntegerField()),
                ("size", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "article",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="images",
                        to="articles.article",
                    ),
                ),
                (
                    "uploader",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="article_images",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="articleimage",
            index=models.Index(
                fields=["article", "-created_at"],
                name="articles_a_article_d1f2a3_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="articleimage",
            index=models.Index(
                fields=["uploader", "-created_at"],
                name="articles_a_uploade_4e7c5f_idx",
            ),
        ),
        migrations.CreateModel(
            name="ArticleLike",
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
                    "article",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="likes",
                        to="articles.article",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="article_likes",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name="articlelike",
            index=models.Index(
                fields=["article", "-created_at"], name="articles_a_article_2b9d1e_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="articlelike",
            index=models.Index(
                fields=["user", "-created_at"], name="articles_a_user_id_8a1f3c_idx"
            ),
        ),
        migrations.AddConstraint(
            model_name="articlelike",
            constraint=models.UniqueConstraint(
                fields=("article", "user"), name="uniq_article_like"
            ),
        ),
        migrations.CreateModel(
            name="ArticleComment",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("body", models.TextField()),
                ("body_html", models.TextField(blank=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "article",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="comments",
                        to="articles.article",
                    ),
                ),
                (
                    "author",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="article_comments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "parent",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="replies",
                        to="articles.articlecomment",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="articlecomment",
            index=models.Index(
                fields=["article", "-created_at"], name="articles_a_article_5e3a8f_idx"
            ),
        ),
        migrations.AddIndex(
            model_name="articlecomment",
            index=models.Index(
                fields=["parent", "-created_at"], name="articles_a_parent__7d2c1b_idx"
            ),
        ),
    ]
