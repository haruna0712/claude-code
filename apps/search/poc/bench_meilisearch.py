"""Meilisearch ベンチマーク script (P2-01).

実機実行手順 (CI では走らせない):

    docker run -d -p 7700:7700 getmeili/meilisearch:v1.6
    python -m apps.search.poc.bench_meilisearch

本ファイルは scaffold のみ。実機実装は別 PR で:
- meilisearch SDK (`meilisearch-python`) を requirements/local.txt に追加
- index = client.index('poc'); index.add_documents(corpus)
- index.search(query.text, { "limit": 10 })
"""

from __future__ import annotations

from apps.search.poc.bench_pg_bigm import BenchResult
from apps.search.poc.dataset import SyntheticTweet
from apps.search.poc.queries import PocQuery


def run_meilisearch_bench(
    corpus: list[SyntheticTweet],
    queries: tuple[PocQuery, ...],
) -> list[BenchResult]:
    """Meilisearch 経由の検索ベンチを走らせる (本実装は実機 PR で)."""
    raise NotImplementedError(
        "Meilisearch bench は実機 (meilisearch-python SDK + コンテナ) の上で本実装する。"
        " 本 PR は scaffold のみ。"
    )
