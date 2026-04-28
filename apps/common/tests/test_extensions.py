"""Postgres extension migration テスト (P2-02 / GitHub #177).

`apps/common/migrations/0001_extensions.py` で pg_bigm / pg_trgm を
`CreateExtension` するため、テスト DB に migrate されたあと両 extension が
`pg_extension` カタログに存在することを確認する。

CI 環境について:
- ローカル / stg / prod の Postgres image (`docker/local/postgres/Dockerfile`) は
  `postgresql-16-pg-bigm` を apt install してから起動する。
- GitHub Actions の `services: postgres:15` はそのままでは pg_bigm パッケージを
  含まないため、CI workflow 側で `docker build` し sidecar として起動する想定
  (詳細は `.github/workflows/ci.yml` の backend job を参照)。
- pg_trgm は標準 image で利用可能なので、pg_bigm が無い環境を想定して当テストは
  `skipif` でフォールバックさせず、pg_bigm が無ければ DB 設定不備として fail させる
  (CI gate として機能させる)。
"""

from __future__ import annotations

import pytest
from django.db import connection


@pytest.mark.django_db(transaction=True)
def test_pg_bigm_extension_is_installed() -> None:
    """`pg_bigm` extension が migrate 後に有効化されていること。"""
    with connection.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension WHERE extname = 'pg_bigm';")
        rows = cur.fetchall()
    assert rows == [("pg_bigm",)], (
        "pg_bigm が見つからない。Postgres image に postgresql-XX-pg-bigm が "
        "apt install されているか、apps/common/migrations/0001_extensions.py が "
        "正しく適用されているか確認すること。"
    )


@pytest.mark.django_db(transaction=True)
def test_pg_trgm_extension_is_installed() -> None:
    """`pg_trgm` extension が migrate 後に有効化されていること (Phase 1 P1-05 で
    タグ編集距離チェックに利用、Phase 2 でも検索フォールバックに使う)。"""
    with connection.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';")
        rows = cur.fetchall()
    assert rows == [("pg_trgm",)], (
        "pg_trgm が見つからない。標準 Postgres image に同梱されているはずなので "
        "migration が走っていない可能性が高い。"
    )


@pytest.mark.django_db(transaction=True)
def test_bigm_similarity_callable() -> None:
    """pg_bigm の `bigm_similarity(text, text)` が呼べることを smoke check。

    extension を入れただけで関数が登録されない場合があるので、実関数を呼んで
    NULL でない数値を返すかを検証する。
    """
    with connection.cursor() as cur:
        cur.execute("SELECT bigm_similarity('python', 'pyhton')::float;")
        (similarity,) = cur.fetchone()
    assert similarity is not None
    assert 0.0 <= similarity <= 1.0
