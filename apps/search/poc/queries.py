"""PoC 用検索クエリセット (P2-01).

Recall@10 / P95 latency を測るための代表クエリ。バランスは:

- 日本語名詞 (15)
- 英単語 / 英フレーズ (15)
- 日本語フレーズ (10)
- コード断片 (10)

合計 50 本。各クエリには ``expected_categories`` を持たせ、PoC ベンチが
「ヒットすべき category のツイートが Top10 に何件含まれるか」を Recall@10
の代替指標として測れるようにする。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PocQuery:
    text: str
    expected_categories: tuple[str, ...]


# 日本語名詞 (Lindera 形態素境界の評価)
JP_NOUNS: tuple[PocQuery, ...] = tuple(
    PocQuery(text=t, expected_categories=("ja_plain", "ja_en_mix"))
    for t in (
        "東京",
        "大阪",
        "渋谷",
        "新宿",
        "技術",
        "開発",
        "問題",
        "学習",
        "情報",
        "資料",
        "会社",
        "社会",
        "人生",
        "時間",
        "場所",
    )
)

# 英単語 / フレーズ
EN_TERMS: tuple[PocQuery, ...] = tuple(
    PocQuery(text=t, expected_categories=("ja_en_mix", "code_block"))
    for t in (
        "engineer",
        "python",
        "django",
        "deploy",
        "docker",
        "framework",
        "service",
        "request",
        "response",
        "client",
        "server",
        "database",
        "production",
        "query string",
        "rate limit",
    )
)

# 日本語フレーズ (bigm が effective かを見る)
JP_PHRASES: tuple[PocQuery, ...] = tuple(
    PocQuery(text=t, expected_categories=("ja_plain",))
    for t in (
        "技術 共有",
        "フレームワーク 比較",
        "コード レビュー",
        "本番 反映",
        "認証 認可",
        "データ ベース",
        "メモリ 不足",
        "パフォーマンス 改善",
        "テスト 自動化",
        "CI 安定",
    )
)

# コード断片 (LIKE / N-gram の trade-off を見る)
CODE_FRAGMENTS: tuple[PocQuery, ...] = tuple(
    PocQuery(text=t, expected_categories=("code_block",))
    for t in (
        "def ",
        "return x",
        "import",
        "class ",
        "raise ",
        "async ",
        "await ",
        "yield ",
        "self.",
        "x * 2",
    )
)

ALL_QUERIES: tuple[PocQuery, ...] = (
    *JP_NOUNS,
    *EN_TERMS,
    *JP_PHRASES,
    *CODE_FRAGMENTS,
)
