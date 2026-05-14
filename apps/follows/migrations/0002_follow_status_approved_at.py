"""#735 鍵アカ機能: ``Follow.status`` + ``Follow.approved_at`` を追加。

spec: docs/specs/private-account-spec.md §2.2

既存 Follow はすべて ``status=approved, approved_at=created_at`` で backfill
(= 公開アカ宛 follow は即承認済として動作、 既存挙動維持)。

chunked update: 5,000 件ずつ id range で update してロック時間を最小化する。
"""

from __future__ import annotations

from django.db import migrations, models


CHUNK_SIZE = 5_000


def backfill_status_and_approved_at(apps, schema_editor):
    """既存 Follow すべてを ``status='approved', approved_at=created_at`` で backfill。"""

    Follow = apps.get_model("follows", "Follow")
    # 既に status を持っている (= AddField default で全行に approved が入っている)
    # ので、 approved_at だけ chunked で created_at にコピーする。
    qs = Follow.objects.filter(approved_at__isnull=True).only("id", "created_at")

    last_id = 0
    while True:
        chunk = list(
            qs.filter(id__gt=last_id).order_by("id").values_list("id", "created_at")[
                :CHUNK_SIZE
            ]
        )
        if not chunk:
            break
        ids = [pk for pk, _ in chunk]
        Follow.objects.filter(id__in=ids).update(approved_at=models.F("created_at"))
        last_id = ids[-1]


def reverse_backfill(apps, schema_editor):
    """approved_at を全部 NULL に戻す ロールバック用。"""

    Follow = apps.get_model("follows", "Follow")
    Follow.objects.update(approved_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("follows", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="follow",
            name="status",
            field=models.CharField(
                choices=[("pending", "承認待ち"), ("approved", "承認済み")],
                default="approved",
                help_text=(
                    "公開アカへの follow は即 approved、 鍵アカへの follow は "
                    "pending → 承認 / 拒否で確定する。"
                ),
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name="follow",
            name="approved_at",
            field=models.DateTimeField(
                blank=True,
                help_text=(
                    "承認時刻 (status=approved になった時刻)。 pending 中は NULL。"
                ),
                null=True,
            ),
        ),
        migrations.RunPython(
            backfill_status_and_approved_at,
            reverse_code=reverse_backfill,
        ),
    ]
