"""pg_bigm + Lindera ベンチマーク script (P2-01).

実機実行手順 (CI では走らせない):

    # PostgreSQL を起動 (pg_bigm 拡張入りのイメージ推奨)
    docker compose -f local.yml up -d postgres
    docker compose -f local.yml exec api \\
        python -m apps.search.poc.bench_pg_bigm

corpus を一時テーブルに INSERT し、各クエリに対して N-gram (`%>` 演算子相当)
で検索 → P95 latency, Recall@10 を計測する。LIKE フォールバックも参考値として
取得する。

本ファイルは現時点で **インポート可能なスケルトン** にとどめる。実機ベンチの
本実装は別 PR で:
- conn = psycopg2.connect(...)
- CREATE TEMP TABLE poc_tweets (id int, body text);
- CREATE INDEX poc_tweets_body_bigm ON poc_tweets USING gin (body gin_bigm_ops);
- 各クエリで EXPLAIN ANALYZE を回し latency を集計
"""

from __future__ import annotations

from typing import TypedDict

from apps.search.poc.dataset import SyntheticTweet
from apps.search.poc.queries import PocQuery


class BenchResult(TypedDict):
    backend: str
    query: str
    matched_ids: list[int]
    latency_ms: float


def run_pg_bigm_bench(
    corpus: list[SyntheticTweet],
    queries: tuple[PocQuery, ...],
) -> list[BenchResult]:
    """pg_bigm 経由の検索ベンチを走らせる (本実装は実機 PR で)."""
    raise NotImplementedError(
        "pg_bigm bench は実機 (psycopg2 + pg_bigm extension) の上で本実装する。"
        " 本 PR は scaffold のみ。"
    )
