# 検索 E2E 実行コマンド

> 関連: [search-spec.md](./search-spec.md), [search-scenarios.md](./search-scenarios.md)
> spec ファイル: [`client/e2e/search-scenarios.spec.ts`](../../client/e2e/search-scenarios.spec.ts) (新規 / Phase 2 追補)
>
> 目的: [search-scenarios.md](./search-scenarios.md) の `SRC-XX` を Playwright で網羅的に走らせるための、環境変数とコマンド集。シナリオ定義 (大きい) とコマンドを分離する。

## 0. 前提

- ローカル: `docker compose -f local.yml up -d` で `api`, `client`, `postgres`, `redis`, `mailpit` を起動済み。
- stg: `https://stg.codeplace.me/` が deploy 済み (P2-22 / #194 で稼働)。
- 認証情報は shell history に残さないため **環境変数で渡す**。`<USER_PASSWORD>` プレースホルダは実値に置き換えて実行する。
- 並列実行は **`--workers=1`**。検索結果の順序検証で stable な状態を期待するため、テスト間で fixture が混ざらないよう直列。
- 検索は AllowAny だが、スパム判定 `anon` 200/day を本番で踏まないように、ログイン状態でテストすることを推奨。

## 1. テストアカウント

ローカル / stg どちらでも以下を使う。シナリオによっては事前 seed が必要 (= `from:alice` を成立させるため `alice` が必要)。

| handle | email               | 用途                                |
| ------ | ------------------- | ----------------------------------- |
| alice  | `alice@example.com` | `from:alice` の照合用、tweet 投稿   |
| bob    | `bob@example.com`   | 別作者で除外検証用                  |
| test2  | `test2@gmail.com`   | 既存 stg seed (代替で alice の代用) |

ローカル seed 例:

```bash
docker compose -f local.yml exec api python manage.py shell <<'PY'
from django.contrib.auth import get_user_model
U = get_user_model()
for handle, email in [("alice","alice@example.com"),("bob","bob@example.com")]:
    u, created = U.objects.get_or_create(username=handle, defaults={"email": email})
    if created:
        u.set_password("supersecret12")  # pragma: allowlist secret
        u.save()
PY
```

## 2. 環境変数

```bash
# 共通
export PLAYWRIGHT_USER1_EMAIL="alice@example.com"
export PLAYWRIGHT_USER1_PASSWORD="<USER1_PASSWORD>"
export PLAYWRIGHT_USER1_HANDLE="alice"
export PLAYWRIGHT_USER2_EMAIL="bob@example.com"
export PLAYWRIGHT_USER2_PASSWORD="<USER2_PASSWORD>"
export PLAYWRIGHT_USER2_HANDLE="bob"

# stg vs local の切り替え
# - local:
export PLAYWRIGHT_BASE_URL="http://localhost:3000"
# - stg:
# export PLAYWRIGHT_BASE_URL="https://stg.codeplace.me"
```

## 3. 全シナリオ実行

```bash
cd /workspace/client
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line
```

stg ターゲット例:

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=alice@example.com PLAYWRIGHT_USER1_PASSWORD='<USER1_PASSWORD>' \
PLAYWRIGHT_USER1_HANDLE=alice \
PLAYWRIGHT_USER2_EMAIL=bob@example.com PLAYWRIGHT_USER2_PASSWORD='<USER2_PASSWORD>' \
PLAYWRIGHT_USER2_HANDLE=bob \
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line
```

## 4. 単独シナリオ実行

```bash
# SRC-01: 単純なキーワードで tweet を検索する
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-01"

# SRC-02: 大文字小文字を区別しない
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-02"

# SRC-03: 空クエリは空結果
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-03"

# SRC-05: tag: で tag 絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-05"

# SRC-06: tag: 複数指定は AND 結合
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-06"

# SRC-07: from: で投稿者絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-07"

# SRC-08: since: / until: で日付範囲絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-08"

# SRC-09: 不正な日付は silent drop
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-09"

# SRC-10: type: で tweet 種別絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-10"

# SRC-11: has:image の絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-11"

# SRC-12: has:code の絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-12"

# SRC-13: 複合演算子で AND 絞り込み
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-13"

# SRC-14: 未知演算子は keyword に流れる
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-14"

# SRC-15: limit のクランプ
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-15"

# SRC-16: limit が int 以外でも default にフォールバック
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-16"

# SRC-17: 結果は新着順
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-17"

# SRC-18: 削除済み tweet は結果に出ない
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-18"

# SRC-20: 未ログインで検索できる
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-20"

# SRC-21: SearchBox 空文字 submit は navigate しない
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-21"

# SRC-22: SearchBox は URL 経由で初期値を受け取る
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-22"

# SRC-26: Navbar HeaderSearchBox から submit すると /search?q= に遷移する
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-26"

# SRC-27: Navbar HeaderSearchBox の空文字 submit は navigate しない
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-27"

# SRC-28: Navbar HeaderSearchBox は URL の q を初期値として受け取らない
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-28"

# SRC-29: Navbar HeaderSearchBox は未ログインでも表示・動作する
npx playwright test e2e/search-scenarios.spec.ts --workers=1 --reporter=line --grep "SRC-29"
```

## 5. Phase 2 既存 golden path との関係

`client/e2e/phase2.spec.ts` (P2-21 / #193) は **golden path 1 本** のみ:

> alice follows bob → reacts to bob's tweet → sees in TL → finds via search

これは「検索ボックスから submit して結果が出る」 smoke 用途で、本書のシナリオ網羅は別 spec (`search-scenarios.spec.ts`) として分離する。

## 6. API 直叩きで通すシナリオ

UI 操作を経由しなくても通る検証は **直接 axios で叩く** スタイルが安定:

```bash
# stg / 未ログインで API 直叩き smoke
curl -s 'https://stg.codeplace.me/api/v1/search/?q=python' | jq '.count, .results[0:3] | .[] | {id, body, author_handle}'

# 演算子検証
curl -s 'https://stg.codeplace.me/api/v1/search/?q=tag:django%20from:alice' | jq '.count'

# limit クランプ確認
curl -s 'https://stg.codeplace.me/api/v1/search/?q=python&limit=500' | jq '.count'
```

サーバ側 pytest:

```bash
docker compose -f local.yml exec api pytest apps/search/tests/ -v
docker compose -f local.yml exec api pytest apps/search/tests/test_parser.py -v -k "tag"
```

## 7. 既知の制約・運用ノート

- **`anon` rate limit**: 未ログインで連投すると本番 200/day を踏む。stg は 2000/day (#336)。
- **fixture 依存**: 結果順序検証 (SRC-17) や複合クエリ (SRC-13) は事前に正しい本文 / tag / created_at の tweet が seed されている必要あり。spec 内 `beforeAll` で API 直叩き seed する戦略を推奨。
- **stg 共有データ汚染**: stg は他のテスト・人手作業で結果が変動する。`SRC-NN` の検証は固有の marker 文字列 (`"e2e-search-marker-<rand>"` 等) を含めて作成し、その marker を含むかで検証する (= 全結果数を期待値で固定しない)。
- **Block 関係の影響**: 現状 検索結果は block 関係を考慮しない (search-spec.md §3.4)。block 済み user の tweet も結果に出るので、検証側はその前提でアサート。
- **Tombstone (削除済み)**: SRC-18 は spec 内で `DELETE /api/v1/tweets/<id>/` を叩いて soft-delete してから検索する。teardown は不要 (soft-delete は復元機能なし)。
- **CI 連携**: 現状 `client/e2e/search-scenarios.spec.ts` は **CI に組み込まない**。理由は phase2.spec.ts と同じ。`.github/workflows/e2e-stg.yml` 整備時にまとめて追加する。
