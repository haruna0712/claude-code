"""PoC ハーネス エントリポイント (P2-01).

両方のバックエンドを順に走らせて JSON で結果を吐く。手動実行のみ:

    python -m apps.search.poc.run > poc-results.json
"""

from __future__ import annotations

import json
import sys

from apps.search.poc.bench_meilisearch import run_meilisearch_bench
from apps.search.poc.bench_pg_bigm import run_pg_bigm_bench
from apps.search.poc.dataset import build_dataset
from apps.search.poc.queries import ALL_QUERIES


def main() -> int:
    corpus = build_dataset()
    results: dict[str, object] = {
        "corpus_size": len(corpus),
        "query_count": len(ALL_QUERIES),
    }

    try:
        results["pg_bigm"] = run_pg_bigm_bench(corpus, ALL_QUERIES)
    except NotImplementedError as exc:
        results["pg_bigm_error"] = str(exc)

    try:
        results["meilisearch"] = run_meilisearch_bench(corpus, ALL_QUERIES)
    except NotImplementedError as exc:
        results["meilisearch_error"] = str(exc)

    json.dump(results, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
