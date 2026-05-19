"""Phase 12 P12-06: Occupation + UserOccupation schema migration.

spec: docs/specs/phase-12-residence-map-spec.md §9
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0008_user_is_private"),
    ]

    operations = [
        migrations.CreateModel(
            name="Occupation",
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
                ("slug", models.SlugField(max_length=50, unique=True)),
                ("display_name", models.CharField(max_length=50)),
                ("display_order", models.PositiveSmallIntegerField(default=100)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["display_order", "slug"],
            },
        ),
        migrations.AddIndex(
            model_name="occupation",
            index=models.Index(
                fields=["is_active", "display_order"],
                name="users_occ_active_order_idx",
            ),
        ),
        migrations.CreateModel(
            name="UserOccupation",
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
                    "occupation",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_occupations",
                        to="users.occupation",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="user_occupations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
        migrations.AddConstraint(
            model_name="useroccupation",
            constraint=models.UniqueConstraint(
                fields=("user", "occupation"),
                name="user_occupation_unique",
            ),
        ),
        migrations.AddIndex(
            model_name="useroccupation",
            index=models.Index(
                fields=["occupation"],
                name="user_occupation_occ_idx",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="occupations",
            field=models.ManyToManyField(
                blank=True,
                related_name="users",
                through="users.UserOccupation",
                to="users.occupation",
            ),
        ),
    ]
