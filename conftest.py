"""ルート conftest.py (P1-21 で導入).

このファイルは pytest セッション全体で共有される fixtures と設定を宣言する。
pytest-django が自動で必要な DB 関連 fixture を供給するので、ここでは
プロジェクト固有の共通 fixture のみを置く。

方針:
- DB セットアップは pytest-django の `django_db_setup` に委譲する (override しない)。
  将来 pg_bigm などの拡張を有効化する必要が出たら、この conftest.py で override する。
- TZ は環境変数経由で Asia/Tokyo に固定する。Django 側は settings.TIME_ZONE を
  参照するため、ここで os.environ["TZ"] を設定するのは OS レベルの時刻関数
  (例: time.localtime) が ja_JP 前提のテストで一貫した結果を返すようにする保険。
- factory-boy の共通 Factory (UserFactory / TweetFactory) は User model が
  P1-02 で拡張された後に本実装する。いまはプレースホルダのみ。
- authenticated API client fixture は CookieAuth (ADR-0003) を使った JWT 発行
  経由で本実装する。P1-02 (User model) + P1-12 (OAuth / JWT 発行) 完了後に
  ここに書き込む。現時点ではスタブのみ。
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

# -----------------------------------------------------------------------------
# pytest_configure: セッション開始時の環境セットアップ
# -----------------------------------------------------------------------------


def pytest_configure(config: pytest.Config) -> None:
    """pytest セッション開始時に TZ を Asia/Tokyo で固定する.

    Django の TIME_ZONE 設定とは別に、OS レベルの時刻関数
    (time.localtime / datetime.now() の aware 化前) がテスト環境で一貫するよう
    環境変数を明示する。CI / ローカル / devcontainer で TZ 差異を吸収する。
    """
    os.environ.setdefault("TZ", "Asia/Tokyo")


# -----------------------------------------------------------------------------
# 共通 API fixtures
# -----------------------------------------------------------------------------


@pytest.fixture
def api_client():
    """DRF の APIClient を返す.

    View / ViewSet テストの基本エントリポイント。認証が必要なテストは
    後述の `authenticated_client` を使う (P1-02 以降で本実装予定)。
    """
    from rest_framework.test import APIClient

    return APIClient()


@pytest.fixture
def authenticated_client():
    """認証済み APIClient を返す (P1-02 以降で本実装).

    TODO(P1-02 / P1-12): User model 拡張と JWT 発行フローが揃ったら、
    - UserFactory でユーザーを作る
    - djoser / simple-jwt で access/refresh トークンを発行
    - ADR-0003 の CookieAuth 方式で `HttpOnly` クッキーに載せる
    という形で本実装する。現在は fail fast で NotImplementedError を投げて
    「まだ書けない」状態を明示する。
    """
    raise NotImplementedError(
        "authenticated_client fixture は P1-02 (User model) + P1-12 (JWT) 後に実装予定。"
    )


# -----------------------------------------------------------------------------
# freezegun ラッパ
# -----------------------------------------------------------------------------


@pytest.fixture
def freezer() -> Iterator:
    """`freezegun.freeze_time` のコンテキストを提供するラッパ fixture.

    使い方:
        def test_something(freezer):
            with freezer("2026-04-23T12:00:00+09:00"):
                ...

    freezegun 自体は `pytest-freezer` 等を入れずに直接 import して使う。
    共通 import 忘れを防ぐためのシンタックスシュガー。
    """
    from freezegun import freeze_time

    yield freeze_time


# -----------------------------------------------------------------------------
# factory-boy 共通 Factory (プレースホルダ)
# -----------------------------------------------------------------------------
# TODO(P1-02): User model 拡張完了後、以下を本実装する。
#
#   import factory
#   from django.contrib.auth import get_user_model
#
#   class UserFactory(factory.django.DjangoModelFactory):
#       class Meta:
#           model = get_user_model()
#           django_get_or_create = ("username",)
#
#       username = factory.Sequence(lambda n: f"user{n}")
#       email = factory.LazyAttribute(lambda o: f"{o.username}@example.com")
#       ...
#
# TODO(P1-07): TweetFactory も同様に apps/tweets の model 実装後に追加する。
# いまは import 時に app registry が整わないと DjangoModelFactory を定義できない
# ため、プレースホルダのコメントのみ残す。


# -----------------------------------------------------------------------------
# Phase 2 共通 fixtures (P2-20)
# -----------------------------------------------------------------------------
# TL / リアクション / 検索 で使う共有 fixture。各 app の test 側で
# `def test_xxx(redis_clean, eager_celery): ...` のように受け取る。


@pytest.fixture
def redis_clean() -> Iterator[None]:
    """各テスト前後で Redis を初期化する fixture。

    実機 Redis を使う統合テスト用。fakeredis に差し替えて完全分離する場合は
    `tests/integration/conftest.py` レベルで monkeypatch する。

    P2-08 (TL Redis ZSET) / P2-09 (trending tags) / P2-04 (reactions counter)
    のテストで使う前提で先出ししておく。
    """
    from django.core.cache import cache

    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def eager_celery(settings) -> Iterator[None]:
    """Celery タスクを同期実行する fixture。

    OGP 取得 (P2-07) / TL 配信 (P2-08) / トレンド集計 (P2-09) など Celery 経由
    の処理を unit test で検証する際に使う。
    """
    settings.CELERY_TASK_ALWAYS_EAGER = True
    settings.CELERY_TASK_EAGER_PROPAGATES = True
    yield
