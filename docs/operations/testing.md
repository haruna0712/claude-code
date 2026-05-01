# テスト運用ガイド (Backend / pytest)

> このドキュメントは P1-21 で pytest / pytest-django を本配線した際に書かれた。
> Phase 1 以降の Issue (P1-02 など) で `test_*.py` を追加したら、ここを更新すること。

## 概要

Backend テストは **pytest + pytest-django** で統一する。Django 標準の `unittest.TestCase`
ベースのテスト (例: `apps/common/tests/test_health.py`) もそのまま discovery されるので
共存可能。

- テストランナー: `pytest` (`pyproject.toml` の `[tool.pytest.ini_options]` を参照)
- Django settings: `config.settings.local` (CI もローカルも共通)
- カバレッジ: `pytest-cov` で計測し、`pyproject.toml` の `--cov-fail-under` で **退行検知** ゲート。
  Phase 1 完了時点では 29% (Phase 1 段階の現状値)。Phase 2 で各 app のテストが
  揃うにつれて段階的に引き上げ、Phase 2 完了で 80% へ移行する (P2-20 follow-up)。

## ローカルで走らせる

### 前提

`requirements/local.txt` を venv にインストールしていること。

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements/local.txt
```

### 全体を一括実行

```bash
pytest
```

`pyproject.toml` の `addopts` により、以下が自動で付く:

- `--reuse-db`: 2 回目以降は DB を使い回して高速化
- `--cov=apps --cov=config`: カバレッジ対象ディレクトリ
- `--cov-report=term-missing`: 未カバー行番号を stdout に表示
- `--cov-report=xml`: `coverage.xml` を生成 (CI アーティファクト用)

### 特定 app だけ走らせる

```bash
pytest apps/users/tests/
pytest apps/tweets/tests/test_models.py
pytest apps/tweets/tests/test_models.py::TestTweetCreation::test_limits_length
```

### DB を作り直したいとき

migration を追加した直後など、`--reuse-db` が裏目に出るケースは `--create-db` で上書き:

```bash
pytest --create-db
```

### カバレッジだけ見たい / 見たくない

- カバレッジ計測を切る (素早く走らせたいとき):

  ```bash
  pytest --no-cov
  ```

- HTML レポートを生成してブラウザで開く:

  ```bash
  pytest --cov-report=html
  open htmlcov/index.html  # macOS
  xdg-open htmlcov/index.html  # Linux
  ```

  `htmlcov/index.html` が生成される。ファイル単位のドリルダウンが可能。

### カバレッジゲート (退行検知) をローカルでも試す

```bash
pytest --cov-fail-under=29
```

`pyproject.toml` の addopts に同じ値を入れているので、`pytest` 単独でもゲートは
効く。Phase 2 で各 app のテストが揃うたびに pyproject の数値を上げていく。
最終的に `--cov-fail-under=80` まで到達したら P2-20 follow-up を close する。

### slow marker (>2s のテスト)

```python
@pytest.mark.slow
def test_full_timeline_70_30_mix():
    ...  # 仕込みデータが多くて 2s 以上かかるテスト
```

CI で slow を分離したい場合:

```bash
pytest -m "not slow"      # PR では fast feedback だけ
pytest -m slow            # main 上で別 job として実行
```

CI と同じ挙動になる。PR を出す前に回しておくと落ちにくい。

## 主要 fixtures

ルート `conftest.py` に定義している共通 fixture:

| Fixture                | 内容                                            | 使いどころ                      |
| ---------------------- | ----------------------------------------------- | ------------------------------- |
| `api_client`           | `rest_framework.test.APIClient` のインスタンス  | 未認証の View / ViewSet テスト  |
| `authenticated_client` | **プレースホルダ** (P1-02 + P1-12 後に本実装)   | 認証が必要な API テスト         |
| `freezer`              | `freezegun.freeze_time` の薄いラッパ            | 時刻依存ロジックの固定          |
| `redis_clean`          | テスト前後で Django キャッシュ (Redis) を flush | TL ZSET / counter / trending 等 |
| `eager_celery`         | `CELERY_TASK_ALWAYS_EAGER=True` で同期実行      | OGP / TL 配信 / トレンド集計    |

### `api_client` の使用例

```python
import pytest

@pytest.mark.django_db
def test_health_endpoint(api_client):
    response = api_client.get("/api/health/")
    assert response.status_code == 200
```

### `freezer` の使用例

```python
def test_tweet_edit_window(freezer):
    with freezer("2026-04-23T12:00:00+09:00"):
        # この with 内では now() が 2026-04-23 12:00 JST に固定される
        ...
```

### 将来追加予定

- `UserFactory` (factory-boy): P1-02 (User model 拡張) 後に追加
- `TweetFactory` (factory-boy): P1-07 (Tweet model) 後に追加
- `authenticated_client`: P1-02 + P1-12 で ADR-0003 CookieAuth を使った JWT 発行が揃った後

## CI での挙動

`.github/workflows/ci.yml` の `backend` ジョブが:

1. `pip install -r requirements/local.txt` で pytest 系も全部入れる
2. `pytest --create-db --maxfail=1` を実行 (`--cov-fail-under` は pyproject 経由で適用)
3. 生成された `coverage.xml` を artifact にアップロード

`--create-db` を明示することで `--reuse-db` (pyproject.toml の既定) を打ち消す。
CI の Postgres service container は毎回真っさらなので reuse しても意味がない。

## トラブルシュート

### `django.core.exceptions.ImproperlyConfigured: Requested setting ...`

`DJANGO_SETTINGS_MODULE` が読まれていない。`pyproject.toml` の
`[tool.pytest.ini_options]` で `config.settings.local` を指定しているため、
pytest をリポジトリルート (`pyproject.toml` がある場所) から叩くこと。

### `psycopg2.OperationalError: could not connect to server`

ローカル Postgres が起動していない。`local.yml` (docker compose) を使う場合:

```bash
docker compose -f local.yml up -d postgres
```

### カバレッジゲートを下回る

1. `pytest --cov-report=term-missing` で未カバー行を確認
2. `htmlcov/index.html` でファイル単位にドリルダウン
3. 「テストが書きづらい」理由が設計由来なら、無理にテストを通すより設計側を直す
