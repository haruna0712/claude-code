"""Phase 2 P2-01 全文検索 PoC ハーネス.

pg_bigm + Lindera vs Meilisearch のベンチマーク用スキャフォールド。
実機ベンチは PostgreSQL (pg_bigm) と Meilisearch コンテナを起動した上で
``python -m apps.search.poc.run`` を手動実行する想定 (CI では走らせない)。

成果物は ADR-0002 の評価軸テーブルに転記し、Status を Accepted (pg_bigm)
または Superseded by 000X (Meilisearch) に確定させる。
"""
