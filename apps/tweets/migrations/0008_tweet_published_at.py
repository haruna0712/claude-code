"""#734 下書き機能: `Tweet.published_at` を追加して既存 row を backfill する。

spec: docs/specs/tweet-drafts-spec.md §2.2

挙動:
1. `AddField` で `published_at: DateTimeField(null=True, default=None, db_index=True)` を追加
2. `RunPython` で既存 Tweet の `published_at = created_at` を chunked update で backfill
   (= 既存 tweet はすべて公開済みとして扱う)

chunked update の理由: stg 50M rows を 1 query で UPDATE するとロック保持時間
が長く、 deploy 中に request が積もって 502 が出る可能性。 10k 件ずつ id range
で update することでロックを細切れにし、 各 chunk 完了で他 query を流せる。
"""

from __future__ import annotations

from django.db import migrations, models


CHUNK_SIZE = 10_000


def backfill_published_at(apps, schema_editor):
    """既存 Tweet すべてを公開済みとして `published_at = created_at` で backfill。"""

    Tweet = apps.get_model("tweets", "Tweet")
    qs = Tweet.objects.filter(published_at__isnull=True).only("id", "created_at")

    last_id = 0
    while True:
        chunk = list(
            qs.filter(id__gt=last_id).order_by("id").values_list("id", "created_at")[
                :CHUNK_SIZE
            ]
        )
        if not chunk:
            break
        # bulk update: published_at = created_at
        ids = [pk for pk, _ in chunk]
        Tweet.objects.filter(id__in=ids).update(
            published_at=models.F("created_at"),
        )
        last_id = ids[-1]


def reverse_backfill(apps, schema_editor):
    """`published_at = NULL` に戻す (= 全部下書きにする) ロールバック用。

    実運用ではほぼ呼ばれない (= ロールバック時はそもそも field を消す)。
    """

    Tweet = apps.get_model("tweets", "Tweet")
    Tweet.objects.update(published_at=None)


class Migration(migrations.Migration):
    dependencies = [
        ("tweets", "0007_tweet_translation"),
    ]

    operations = [
        migrations.AddField(
            model_name="tweet",
            name="published_at",
            field=models.DateTimeField(
                blank=True,
                db_index=True,
                default=None,
                help_text=(
                    "公開時刻。 NULL = 下書き、 値あり = 公開済み。 "
                    "下書きを「公開する」 で now() に更新 (created_at も同時に更新)。"
                ),
                null=True,
            ),
        ),
        migrations.RunPython(
            backfill_published_at,
            reverse_code=reverse_backfill,
        ),
    ]
