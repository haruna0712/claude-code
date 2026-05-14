"""P13-04: User に preferred_language + auto_translate を追加。

spec: docs/specs/auto-translate-spec.md §4.2
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0006_user_search_gin_indexes"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="preferred_language",
            field=models.CharField(
                choices=[
                    ("ja", "日本語"),
                    ("en", "English"),
                    ("ko", "한국어"),
                    ("zh-cn", "简体中文"),
                    ("es", "Español"),
                    ("fr", "Français"),
                    ("pt", "Português"),
                ],
                default="ja",
                help_text="UI display language and default translation target.",
                max_length=8,
                verbose_name="Preferred Language",
            ),
        ),
        migrations.AddField(
            model_name="user",
            name="auto_translate",
            field=models.BooleanField(
                default=False,
                help_text="Automatically translate foreign-language tweets on render.",
                verbose_name="Auto Translate",
            ),
        ),
    ]
