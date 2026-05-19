"""Phase 12 P12-06: Initial seed for Occupation (controlled vocabulary).

spec: docs/specs/phase-12-residence-map-spec.md §9.3

冪等 (``update_or_create``) — re-run しても重複を増やさない。
admin から後で増減可能。
"""

from django.db import migrations

INITIAL_OCCUPATIONS = [
    # (slug, display_name, display_order)
    ("designer", "デザイナー", 10),
    ("frontend", "フロントエンドエンジニア", 20),
    ("backend", "バックエンドエンジニア", 30),
    ("fullstack", "フルスタックエンジニア", 40),
    ("mobile", "モバイルエンジニア", 50),
    ("ml", "ML / AI エンジニア", 60),
    ("data", "データエンジニア / アナリスト", 70),
    ("sre", "SRE / インフラ", 80),
    ("security", "セキュリティ", 90),
    ("game", "ゲーム開発", 100),
    ("embedded", "組み込み / ハードウェア", 110),
    ("qa", "QA / テスト", 120),
    ("pm", "プロダクトマネージャ", 130),
    ("em", "エンジニアリングマネージャ", 140),
    ("student", "学生", 150),
    ("other", "その他", 999),
]


def seed_occupations(apps, schema_editor):
    Occupation = apps.get_model("users", "Occupation")
    for slug, display_name, display_order in INITIAL_OCCUPATIONS:
        Occupation.objects.update_or_create(
            slug=slug,
            defaults={
                "display_name": display_name,
                "display_order": display_order,
                "is_active": True,
            },
        )


def unseed_occupations(apps, schema_editor):
    """rollback 時の cleanup。 admin が後から追加した行は触らないので、
    INITIAL_OCCUPATIONS の slug のみ削除する。"""
    Occupation = apps.get_model("users", "Occupation")
    slugs = [s for s, _, _ in INITIAL_OCCUPATIONS]
    Occupation.objects.filter(slug__in=slugs).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0009_occupation_useroccupation"),
    ]

    operations = [
        migrations.RunPython(seed_occupations, unseed_occupations),
    ]
