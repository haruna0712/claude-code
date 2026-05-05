# リアクション E2E 実行コマンド

> 関連: [reactions-spec.md](./reactions-spec.md), [reactions-scenarios.md](./reactions-scenarios.md)
> spec ファイル: [`client/e2e/reactions-scenarios.spec.ts`](../../client/e2e/reactions-scenarios.spec.ts) (新規 / Phase 2 追補)
>
> 目的: [reactions-scenarios.md](./reactions-scenarios.md) の `RCT-XX` を Playwright で網羅的に走らせるための、環境変数とコマンド集。シナリオ定義 (大きい) とコマンドを分離する。

## 0. 前提

- ローカル: `docker compose -f local.yml up -d` で `api` (:8000), `client` (:3000), `postgres`, `redis`, `mailpit` (:8025) を起動済み。
- stg: `https://stg.codeplace.me/` が deploy 済み (P2-22 / #194 で稼働)。
- 認証情報は shell history に残さないため **環境変数で渡す**。`<USER_PASSWORD>` プレースホルダは実値に置き換えて実行する。
- 並列実行は **`--workers=1`**。Reaction はカウンタ整合性が観点なので、テスト同士の race を避ける。

## 1. テストアカウント

ローカル / stg どちらでも以下 2 アカウントを seed 済みで使う想定。

| handle | email             | 用途                                        |
| ------ | ----------------- | ------------------------------------------- |
| test2  | `test2@gmail.com` | USER1 (actor / リアクションを付ける側)      |
| test3  | `test3@gmail.com` | USER2 (target tweet 作成者、被アクション側) |

block 関係シナリオ (`RCT-08`, `RCT-09`) では別途 `test4` 等を準備する (= 任意 user で OK、stg では block API を直接叩いて状態を作る)。

## 2. 環境変数

```bash
# 共通
export PLAYWRIGHT_USER1_EMAIL="test2@gmail.com"
export PLAYWRIGHT_USER1_PASSWORD="<USER1_PASSWORD>"
export PLAYWRIGHT_USER1_HANDLE="test2"
export PLAYWRIGHT_USER2_EMAIL="test3@gmail.com"
export PLAYWRIGHT_USER2_PASSWORD="<USER2_PASSWORD>"
export PLAYWRIGHT_USER2_HANDLE="test3"

# stg vs local の切り替え
# - local:
export PLAYWRIGHT_BASE_URL="http://localhost:3000"
# - stg:
# export PLAYWRIGHT_BASE_URL="https://stg.codeplace.me"
```

## 3. 全シナリオ実行

```bash
cd /workspace/client
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line
```

stg ターゲット例 (rate limit に注意、`reaction` scope は stg で 600/min):

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com PLAYWRIGHT_USER1_PASSWORD='<USER1_PASSWORD>' \
PLAYWRIGHT_USER1_HANDLE=test2 \
PLAYWRIGHT_USER2_EMAIL=test3@gmail.com PLAYWRIGHT_USER2_PASSWORD='<USER2_PASSWORD>' \
PLAYWRIGHT_USER2_HANDLE=test3 \
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line
```

## 4. 単独シナリオ実行

```bash
# RCT-01: 未リアクションの tweet にリアクションを付ける
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-01"

# RCT-02: 同じ kind を再度押して取り消す
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-02"

# RCT-03: 別 kind に変更する (UPDATE 経路)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-03"

# RCT-04: 明示 DELETE エンドポイントで取り消す
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-04"

# RCT-05: 既存なしで DELETE すると 404
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-05"

# RCT-06: 集計 GET (未ログインも可)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-06"

# RCT-07: 削除済み tweet にリアクションできない
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-07"

# RCT-08: 双方向 Block 関係の相手にはリアクションできない
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-08"

# RCT-10: 認証なし POST は 401
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-10"

# RCT-11: 不正な kind は 400
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-11"

# RCT-13: self-reaction は許可される
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-13"

# RCT-14: API 失敗時に optimistic update がロールバックする
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-14"

# RCT-16: 種類変更時に reaction_count が drift しない
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-16"

# RCT-17: Alt+Enter で grid 開閉できる
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-17"

# RCT-19: 削除済み tweet の集計 GET は 404
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-19"

# RCT-21: kind 選択で popup が即時 close する (#379)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-21"

# RCT-22: popup 外を click すると popup が close する (#379)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-22"

# RCT-23: Escape キーで popup が close する (#379)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-23"

# RCT-25: trigger を click すると quick toggle で like される (#381)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-25"

# RCT-26: my_kind=K のときに trigger を click すると K を取消す (#381)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-26"

# RCT-27: trigger を 500ms 以上長押しすると picker が開く (#381)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-27"

# RCT-28: 短押しは quick toggle のみ (#381)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-28"

# RCT-30: 長押し後 picker から kind 選択 (#381 + #379)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-30"

# RCT-31: Enter キーで quick toggle (#381)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-31"

# RCT-32: Alt+Enter キーで picker 開閉 (#381 / #187)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-32"

# RCT-33: trigger emoji は viewer 視点 (#383)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-33"

# RCT-34: ReactionSummary は total=0 で非表示 (#383)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-34"

# RCT-35: ReactionSummary は count 降順で上位 N 種を表示 (#383)
npx playwright test e2e/reactions-scenarios.spec.ts --workers=1 --reporter=line --grep "RCT-35"
```

## 5. Phase 2 既存 golden path との関係

`client/e2e/phase2.spec.ts` (P2-21 / #193) は **golden path 1 本** をカバーするだけ:

> alice follows bob → reacts to bob's tweet → sees in TL → finds via search

これは「リアクションが画面上で押せるか」「TL / 検索が回るか」の **smoke** 用途で、本書のシナリオ網羅は別 spec (`reactions-scenarios.spec.ts`) として分離する。

## 6. 既知の制約・運用ノート

- **Rate limit**: stg は `reaction` scope 600/min、本番は 60/min。連続実行で 429 を踏むと `RCT-12` 以外のシナリオも巻き添えになるので、`--workers=1` を厳守し、必要なら test 間に 1 秒待機。
- **Block 関係シナリオ (RCT-08, RCT-09)**: stg では block API (`POST /api/v1/users/<handle>/block/`) を spec 内 setup で叩いて状態を作る。teardown で `DELETE` で解除する。test 間で残らないように注意。
- **Optimistic rollback (RCT-14)**: Playwright の `page.route()` でレスポンスを 500 に書き換えて検証する。本番 / stg では発生しにくいので mock 必須。
- **同時 race (RCT-15)**: ブラウザ単体では再現困難。サーバ側 pytest (`apps/reactions/tests/test_reaction_api.py`) で `IntegrityError` path をカバー済み。E2E では UI から 1 click ずつ叩く。
- **CSRF**: `client/src/lib/api/client.ts` の `ensureCsrfToken` がリクエスト前に呼ばれる。stg で 403 になった場合は cookie 残留 / token mismatch を疑う。
- **アカウントが seed されていない場合**: ローカルなら `docker compose -f local.yml exec api python manage.py shell -c "..."` で `User.objects.create_user(...)` するか、`/admin/` で作成。

## 7. CI 連携

現状 `client/e2e/reactions-scenarios.spec.ts` は **CI に組み込まない**。理由は P2-21 の golden path と同じく:

- フル docker compose stack の起動コストが大きい
- 認証情報の secret 管理を CI 側で整えるまで保留

`.github/workflows/e2e-stg.yml` (Phase 2 末で追加予定 / 別 issue) で stg deploy 後に手動 trigger する想定。
