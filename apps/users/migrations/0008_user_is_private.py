"""#735 鍵アカ機能: ``User.is_private`` 追加。

spec: docs/specs/private-account-spec.md §2.1

既存 user はすべて ``is_private=False`` で backfill (= 公開アカ、 従来挙動維持)。
"""

from __future__ import annotations

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0007_user_language_preferences"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="is_private",
            field=models.BooleanField(
                default=False,
                help_text=(
                    "Whether this account is private. New follow requests "
                    "require approval, and only approved followers can see "
                    "this user's tweets."
                ),
                verbose_name="Is Private (鍵アカ)",
            ),
        ),
    ]
