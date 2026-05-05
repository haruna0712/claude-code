# 検索シナリオ仕様

> 関連: [search-spec.md](./search-spec.md), [search-e2e-commands.md](./search-e2e-commands.md)
>
> 目的: 検索 (`/api/v1/search/` + `/search` ページ) の文法・API・UI 挙動を、E2E 化しやすい形で固定する。

## 1. 用語

| 用語          | 定義                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| query (q)     | URL の `?q=...` に渡す検索文字列                                                          |
| 演算子        | `<key>:<value>` 形式の token。`tag` / `from` / `since` / `until` / `type` / `has` の 6 種 |
| keyword       | 演算子に該当しなかった残りの token (空白連結後の文字列)                                   |
| 結果カード    | `/search` ページに描画される 1 tweet 分のカード                                           |
| MAX_LIMIT     | `apps/search/services.py::MAX_LIMIT = 100`                                                |
| DEFAULT_LIMIT | `apps/search/services.py::DEFAULT_LIMIT = 20`                                             |

## 2. 基本方針

- 検索は **未ログインでも実行可能** (AllowAny)。
- パラメータ不正・未知演算子・不正値は **silent drop** で 200 + 部分結果 (例外を投げない)。
- 空クエリ (`q=""` / `q="   "` / 演算子も無し) は **空結果**。
- 結果は **新着順** (`created_at desc`, tie は `id desc`)。
- 結果数は `min(limit, MAX_LIMIT=100)`、default は 20。
- 削除済み tweet は default Manager で除外 → 結果に出ない。
- Block 関係 (現状) は結果に **反映しない**。
- インフラは Postgres `body__icontains` + pg_bigm GIN index (ADR-0002 PoC 採用)。
- 対象は tweet 本文のみ (article は Phase 6 以降)。

## 3. 検索シナリオ一覧

### SRC-01: 単純なキーワードで tweet を検索する

前提:

- ユーザ B が `body="python is fun"` の tweet T1、`body="rust is safe"` の tweet T2 を投稿済み。

操作:

- 任意のクライアントが `GET /api/v1/search/?q=python` を叩く。
- または `/search?q=python` ページを開く。

期待結果:

- API: **200**。
- レスポンス body: `{query: "python", results: [<T1>, ...], count: >=1}`。
- T1 (python を含む) は結果に含まれる。
- T2 (python を含まない) は結果に含まれない。
- UI: 結果カードに T1 の本文が表示される。
- UI: ヘッダに `「python」の検索結果: <count> 件` が表示される。

### SRC-02: 大文字小文字を区別しない

前提:

- B の tweet T1 に `python` の文字列を含む。

操作:

- `GET /api/v1/search/?q=PYTHON`。

期待結果:

- API: 200、T1 が結果に含まれる (`body__icontains` のため)。

### SRC-03: 空クエリは空結果

前提:

- 検索可能な tweet が存在する。

操作:

- `GET /api/v1/search/?q=` または `GET /api/v1/search/?q=%20%20` (空白のみ)。

期待結果:

- API: 200。
- レスポンス body: `{query: "" or "   ", results: [], count: 0}`。
- UI: 検索ボックスは出るが、結果セクションは表示されず、CTA テキスト「上のボックスにキーワードを入れて検索してください。」が出る。

### SRC-04: クエリ前後の空白は trim される

前提:

- B の tweet T1 が `python` を含む。

操作:

- `GET /api/v1/search/?q=%20%20python%20%20`。

期待結果:

- 内部的に `python` として処理。
- T1 が結果に含まれる。
- レスポンス body の `query` は **strip 済みの文字列** (`apps/search/views.py::SearchView.get` 内で `(request.query_params.get("q") or "").strip()` 後の値が echo される)。例: `?q=  python  ` → `query: "python"`。

### SRC-05: `tag:<name>` で tag 絞り込み

前提:

- T1 が `body="hello"` で tag `django` を持つ。
- T2 が `body="hello"` で tag `python` を持つ。

操作:

- `GET /api/v1/search/?q=hello%20tag:django`。

期待結果:

- API: 200。
- T1 のみ含まれる。T2 は除外。
- 演算子 `tag:#Django` も小文字化されて `django` 一致 (= T1 ヒット)。

### SRC-06: `tag:` 複数指定は AND 結合

前提:

- T1 が tag `django` と `python` を両方持つ。
- T2 は `django` のみ。

操作:

- `GET /api/v1/search/?q=tag:django%20tag:python`。

期待結果:

- T1 のみ含まれる。T2 は除外。

### SRC-07: `from:<handle>` で投稿者絞り込み

前提:

- alice が tweet T1 を投稿。
- bob が tweet T2 を投稿。

操作:

- `GET /api/v1/search/?q=from:alice`。
- `GET /api/v1/search/?q=from:@alice` (前置 `@`)。

期待結果:

- 両クエリとも T1 のみ含まれる (handle 大文字小文字無視で iexact 比較)。
- `from:bad-handle!` (記号入り) は drop され、空クエリ扱い → 空結果 or keyword に流れる。

### SRC-08: `since:` / `until:` で日付範囲絞り込み

前提:

- 2026-01-15 投稿の T1。
- 2026-04-01 投稿の T2。
- 2026-12-31 投稿の T3。

操作:

- `GET /api/v1/search/?q=since:2026-02-01`。
- `GET /api/v1/search/?q=until:2026-04-01`。
- `GET /api/v1/search/?q=since:2026-02-01%20until:2026-12-30`。

期待結果:

- `since:2026-02-01` → T2, T3 含まれる (T1 除外)。
- `until:2026-04-01` → T1, T2 含まれる (T3 除外、until は inclusive で 2026-04-01 23:59:59 まで)。
- `since:2026-02-01 until:2026-12-30` → T2 のみ。

### SRC-09: 不正な日付は silent drop

前提:

- 任意の tweet が存在。

操作:

- `GET /api/v1/search/?q=since:2026-13-99` (存在しない月日)
- `GET /api/v1/search/?q=since:yesterday`

期待結果:

- API: 200。
- `since` は drop され、フィルタとして適用されない。
- keyword も他に無ければ空クエリ扱い → 空結果。

### SRC-10: `type:<kind>` で tweet 種別絞り込み

前提:

- T_orig (`type=original`)、T_reply (`type=reply`)、T_repost (`type=repost`)、T_quote (`type=quote`) が存在し、いずれも `python` を含む。

操作:

- `GET /api/v1/search/?q=python%20type:reply`。

期待結果:

- T_reply のみ含まれる。
- `type:foo` (許可外) は drop。

### SRC-11: `has:image` で添付画像ありの絞り込み

前提:

- T1 (画像添付あり)、T2 (添付なし) ともに `python` を含む。

操作:

- `GET /api/v1/search/?q=python%20has:image`。

期待結果:

- T1 のみ含まれる。

### SRC-12: `has:code` で Markdown コードブロックを含む tweet の絞り込み

前提:

- T1 の body に ` ``` ` (3 連続バッククォート) が含まれる。
- T2 の body にコードブロックなし。

操作:

- `GET /api/v1/search/?q=has:code`。

期待結果:

- T1 のみ含まれる。
- インライン code (バッククォート 1 個) は対象外 (フェンス記法のみ)。

### SRC-13: 複合演算子で AND 絞り込み

前提:

- alice が `body="kubernetes"` で tag `k8s`、2026-01-15 投稿の T1。

操作:

- `GET /api/v1/search/?q=kubernetes%20tag:k8s%20from:alice%20since:2026-01-01`。

期待結果:

- T1 が結果に含まれる。
- 各演算子は AND 結合。

### SRC-14: 未知演算子は keyword に流れる

前提:

- T1 の body に `foo:bar` という文字列を含む。

操作:

- `GET /api/v1/search/?q=foo:bar` (`foo` は 6 種に無い)。

期待結果:

- `foo:bar` は literal として keywords に積まれる。
- `body__icontains="foo:bar"` で T1 が含まれる。
- silent miss を避ける fail-open 設計。

### SRC-15: limit のクランプ

前提:

- 検索ヒットする tweet が 200 件存在。

操作:

- `GET /api/v1/search/?q=python&limit=500` (= MAX_LIMIT=100 を超過)。

期待結果:

- API: 200。
- `count` は 100 以下。
- `results` 配列の長さは 100 以下。

### SRC-16: limit が int 以外でも default にフォールバック

前提:

- 検索ヒットする tweet が 30 件存在。

操作:

- `GET /api/v1/search/?q=python&limit=abc`。

期待結果:

- API: 200、500 エラーにならない。
- DEFAULT_LIMIT=20 が適用され、`count <= 20`。

### SRC-17: 結果は新着順

前提:

- T1 (古い) と T2 (新しい) がいずれも `python` を含む。

操作:

- `GET /api/v1/search/?q=python`。

期待結果:

- `results[0]` は T2 (新しい方)。
- `results[1]` は T1。
- 同じ created_at の場合は id 大が先。

### SRC-18: 削除済み tweet は結果に出ない

前提:

- T1 を投稿後に soft-delete (`is_deleted=True`)。

操作:

- `GET /api/v1/search/?q=<T1 の本文>`。

期待結果:

- T1 は結果に含まれない。
- T1 の作者プロフィール上にも出ない (default Manager で除外)。

### SRC-19: 元 tweet 削除済みの quote は結果に出る (placeholder 表示)

前提:

- B が source tweet S を投稿、A が S を引用 (quote tweet Q) した後、B が S を削除。

操作:

- `GET /api/v1/search/?q=<Q の引用本文に含まれる文字列>`。

期待結果:

- Q が結果に含まれる (alive)。
- UI 上は埋め込み元 tweet 部分が「このポストは表示できません」 placeholder にレンダされる (TweetCard 経由 / 結果カードで簡易表示の場合は引用元表示なし)。

### SRC-20: 未ログインで検索できる

前提:

- 検索ヒット候補 tweet が存在。
- リクエスト元は認証 cookie / token を持たない。

操作:

- `GET /api/v1/search/?q=python`。

期待結果:

- API: **200** (AllowAny)。
- 通常通り結果が返る。
- 未ログインユーザは結果カードの個別アクション (フォロー / リアクション等) は使えないが、本文閲覧と詳細遷移はできる。

### SRC-21: SearchBox 空文字 submit は navigate しない

前提:

- ユーザが `/search` ページを開いている。

操作:

- 空のまま、または空白のみで submit ボタンを押す。

期待結果:

- URL は `/search` のまま (q parameter が付かない)。
- 結果セクションは表示されない (= CTA のみ)。
- 演算子ヘルプの `<details>` は閉じたまま。

### SRC-22: SearchBox は URL 経由で初期値を受け取る

前提:

- 直接 `/search?q=python%20tag:django` にアクセス。

操作:

- ページがロードされる。

期待結果:

- 検索ボックスの input value は `python tag:django` (decode 済み)。
- 結果セクションに該当 tweet が描画される。

### SRC-23: 演算子のみで keywords 空でも検索が走る

前提:

- alice の tweet T1 (本文に `python` 含む)。

操作:

- `GET /api/v1/search/?q=from:alice`。

期待結果:

- API: 200。
- T1 が結果に含まれる (alice の tweet 全部が候補)。
- `keywords=""` でも `parsed.from_handle != None` で `has_filter=True`。

### SRC-24: タグハッシュタグの `#` プレフィックスは無視

前提:

- T1 が tag `python` を持つ。

操作:

- `GET /api/v1/search/?q=tag:%23python`。

期待結果:

- `#python` の `#` を strip し `python` として一致。
- T1 が含まれる。

### SRC-25: 大量同時 anon リクエストで rate limit を踏む

前提:

- 未ログインで連続 201 件の `/api/v1/search/` リクエストを 24h 以内に送る (本番設定)。

操作:

- 同一 IP から検索を連投。

期待結果:

- 200/day を超えたリクエストは **429**。
- `Retry-After` header 付与。
- UI は generic な error 表示 (現状)。

## 4. E2E 化メモ

各 E2E は上記の `SRC-XX` をテスト名に含める。

推奨する検証観点:

- API レスポンスの `count` / `results[N].id` / `results[N].body` の照合。
- HTTP status (200 / 429)、不正入力でも 200。
- UI で結果カードの本文 / author / tags が描画される。
- 削除済み tweet が結果に出ない。
- 演算子の AND 結合が効く (複合クエリの結果集合が積になる)。
- limit クランプが効く (`limit=500` でも 100 以下)。
- 並び順が新着順。

実行コマンドと具体的な Playwright 手順は [search-e2e-commands.md](./search-e2e-commands.md) を参照。
