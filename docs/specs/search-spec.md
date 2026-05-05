# 検索機能 仕様書

> Version: 0.1
> 最終更新: 2026-05-05
> ステータス: 実装済み (Phase 2 P2-11 / #205, P2-12 / #206, P2-16 / #207 完了済み)
> 関連: [SPEC.md §10](../SPEC.md), [ADR-0002](../adr/0002-search-infrastructure.md), [search-scenarios.md](./search-scenarios.md), [search-e2e-commands.md](./search-e2e-commands.md)

---

## 0. このドキュメントの位置づけ

本プロジェクトの **検索 (Search)** 機能の **クエリ文法 / API 挙動 / フロント描画 / Block 連動 / Tombstone 扱い** を仕様として固定する。`docs/SPEC.md §10` は対象範囲と演算子の存在しか触れていないので、parser の文法、未知演算子の扱い、空クエリ、limit、未ログインの可視性、削除済み tweet の扱いなど細部を本書で確定させる。

**ゴール**: tweet 本文に対する **キーワード検索 + 6 種演算子** で絞り込みでき、未ログインでも検索可能 (SEO 対象)、削除済み / Block 関係はサーバ側で除外されるという不変条件を、UI / API / DB 全レイヤで一貫させる。

> **MVP 範囲**: tweet 本文のみ対象。`SPEC §10.1` で記事 (article) も対象に含める計画があるが、Phase 6 (記事機能) 完成までは tweet のみ。タブ「すべて」「ツイート」「記事」のうち、現状は「ツイート」のみ動作する。

> **インフラ**: 当面は Postgres `body__icontains` + pg_bigm GIN index で運用 (ADR-0002 の PoC 結果)。`SPEC §10.2` の Meilisearch は検索負荷が pg_bigm 限界 (P95 200ms 超 or 月間 1M クエリ) を超えたら導入検討。

---

## 1. 用語

| 用語       | 定義                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------- |
| クエリ     | URL の `?q=...` に乗る検索文字列 (生)。空白区切りで token に分割される                    |
| token      | クエリを空白で split した 1 単位                                                          |
| 演算子     | `<key>:<value>` 形式の token。`tag` / `from` / `since` / `until` / `type` / `has` の 6 種 |
| keyword    | 演算子に該当しなかった残りの token。スペース連結して `body__icontains` に渡される         |
| 未知演算子 | `<key>:<value>` の文法には合うが key が 6 種に無い token                                  |
| 不正値     | key は正しいが value が文法に合わない token (例: `since:yesterday`, `from:bad-handle!`)   |

---

## 2. クエリ文法

### 2.1 全体規則

`apps/search/parser.py::parse_search_query` が正本。

- 空白で token に分割。**引用符 (`"phrase search"`) はサポートしない** (TODO / 将来 follow-up)。
- 各 token を順に判定:
  1. `^[a-z]+:.+$` の正規表現にマッチするか
  2. マッチしたら `key` を 6 種演算子と照合
  3. 6 種ならそれぞれの value 検証 → 通れば struct に格納
  4. 未知演算子は **literal として keyword に積む** (silent miss を避けるため)
  5. 不正値は **silent drop** (例外を投げない)
- 残った非演算子 token を `" ".join(...)` して `keywords` に入れる。
- 大文字小文字は **value を小文字化** する演算子と、しないものが混在 (§2.2 個別)。

設計の指針: **ユーザ入力で例外を投げない**。fail-open で何かしら結果を返すことを優先 (検索 UX)。

### 2.2 演算子個別仕様

#### `tag:<name>`

- value 例: `tag:django`, `tag:#Django`, `tag:Python`
- value から先頭 `#` を strip し、**小文字化** して `parsed.tags` に append。
- **複数指定可能** (`tag:django tag:python` で AND 結合)。
- 同じ tag の重複指定は dedupe しない (Tag テーブルの一意性で結果は同じ)。
- value が空 (`tag:`) は drop。
- バックエンド: `qs.filter(tweet_tags__tag__name=tag)` を tags 個数だけ重ねる。`distinct()` 必要。

#### `from:<handle>`

- value 例: `from:alice`, `from:@alice`
- value 先頭の `@` を strip。残りが `^[A-Za-z0-9_]{1,32}$` にマッチすれば `parsed.from_handle` にセット。**大文字小文字は保持** (DB 検索は `iexact` で吸収)。
- マッチしない (ハイフン / 記号 / 33 文字以上) は drop。
- 後勝ち: 複数指定すると最後の値が勝つ (parser 実装上)。
- バックエンド: `qs.filter(author__username__iexact=parsed.from_handle)`。

#### `since:<YYYY-MM-DD>` / `until:<YYYY-MM-DD>`

- value 例: `since:2026-01-15`, `until:2026-12-31`
- `datetime.strptime(value, "%Y-%m-%d").date()` でパース。失敗は drop (silent)。
- タイムゾーンは **JST** (`timezone.get_current_timezone()`)。
- `since` は **inclusive**: `created_at >= 当日 00:00 JST`。
- `until` は **inclusive (人間直感)** = サーバ内部では **exclusive 翌日 00:00**: `created_at < (until + 1 day) 00:00 JST`。`until:2026-04-23` は 2026-04-23 23:59:59 JST まで含む。
- 範囲が逆転 (`since > until`) でも parser は drop しない。サービス層も例外を投げず空結果を返す。
- 後勝ち: 複数指定で最後の値が勝つ。

#### `type:<kind>`

- 許可値: `original` / `reply` / `repost` / `quote` (lowercase 比較)。
- 6 種以外 (`type:foo`) は drop。
- バックエンド: `qs.filter(type=parsed.type)`。
- 後勝ち。

#### `has:<kind>`

- 許可値: `image` / `code`。
- バックエンド:
  - `has:image` → `qs.filter(images__isnull=False)` + `distinct()`
  - `has:code` → `qs.filter(body__contains='```')` (Markdown フェンス検知)
- 複数指定可。重複は parser 側で dedupe。
- 6 種以外 (`has:video` 等) は drop。

### 2.3 keywords (フリーテキスト)

- 演算子に該当しなかった全 token を空白連結。
- バックエンド: `qs.filter(body__icontains=parsed.keywords)`。
- **case-insensitive** (`icontains`)。
- 複数 token は **連結後の文字列を 1 つの substring** として扱う (= スペース込みで 1 substring 一致)。事前空白 strip 済み。
- pg_bigm GIN index が `LIKE '%...%'` を加速する。Postgres 以外 (sqlite テスト時) は素のシーケンシャルスキャン。

### 2.4 空クエリ・空結果

- `q=""`, `q="   "`, `q=None` (= URL に q 無し): `services.search_tweets` は **即座に空リスト** を返す。`has_filter=False` の経路。
- 演算子が 1 つでも有効に立てば、keywords 空でも検索実行 (例: `tag:django` 単独 OK)。
- 結果 0 件: 200 で `{query, results: [], count: 0}`。

### 2.5 limit

- query string `?limit=N` で指定可能。`max(1, min(N, MAX_LIMIT))` でクランプ。
- `MAX_LIMIT = 100`、`DEFAULT_LIMIT = 20` (`apps/search/services.py`)。
- `limit` が int 以外 / 空文字: DEFAULT_LIMIT にフォールバック (例外を投げない)。

### 2.6 並び順

- `qs.order_by("-created_at", "-id")[:capped]`。**新着順** (created_at 降順、tie-breaker は id 降順)。
- SPEC §10.4 の「関連度順」は未実装 (Meilisearch 移行後 or 別演算子で対応予定)。
- ページング (cursor / page) は **未実装** (limit のみ)。

---

## 3. API

### 3.1 GET `/api/v1/search/`

- 認証: **AllowAny** (未ログインも可)。
- query string:
  - `q` (str, 必須相当) — クエリ。空なら空結果。
  - `limit` (int, optional) — 1〜100。default 20。
- レスポンス:
  ```json
  {
    "query": "python tag:django",
    "results": [<TweetListSerializer>, ...],
    "count": 5
  }
  ```
- `count` は **このレスポンスに含まれる結果数**。総ヒット数ではない (= ページングが無いので実装上同じ意味)。
- 結果は `TweetListSerializer` でシリアライズ。`reaction_count`, `repost_count`, `quote_count`, `tags`, `author_handle`, `html` 等を含む。
- 削除済み tweet は default Manager で除外されるので結果に出ない。

### 3.2 エラー

- query 文字列が壊れていても **200 で空結果** (parser が silent drop するため)。
- `limit` が int 以外でも 200 (default にフォールバック)。
- 4xx / 5xx は通常運用で発生しない。サーバエラーのみ 500。

### 3.3 Rate limit

- DRF default の `AnonRateThrottle` (`anon` scope) と `UserRateThrottle` (`user` scope) が適用される。検索専用 scope は無い。
- 未ログインで連投すると `anon` の 200/day (本番) / 2000/day (stg) を踏む。
- 429 のときは `Retry-After` 付き。

### 3.4 Block 連動

- 検索結果は **block 関係を考慮しない** (現実装)。block している author の tweet も結果に出る可能性がある。
- 厳格に除外するには `services.search_tweets` に request 引数を渡し、`apps.common.blocking.exclude_blocked_tweets` 相当の filter を追加する必要 (TODO / 別 issue)。
- MVP 段階では「Block 関係でも公開検索結果に出る」 = SPEC §11 と整合 (Block は TL と通知の話で、検索結果除外ではない、と解釈)。

---

## 4. フロント

### 4.1 `/search` ページ

`client/src/app/(template)/search/page.tsx` が正本。

- Server Component で `searchParams.q` を読み、サーバサイドで `fetchSearch` を呼ぶ。
- 認証情報は `cookies()` 経由で SSR fetch に乗る (= ログインユーザのレコメンド調整は今後 / 現状 anon と同じ結果)。
- レスポンスを `TweetListSerializer` 形式で受けて、`html` を `sanitizeTweetHtml` で消毒したうえで `dangerouslySetInnerHTML`。
- 結果カードは現状 `TweetCard` を使わず軽量描画 (author + body + tags のみ)。フォロー / リアクション / repost 等のアクションは出ない (= 詳細遷移してから操作する設計)。

### 4.2 `SearchBox`

`client/src/components/search/SearchBox.tsx` が正本。

- `<form role="search">` + controlled input。
- submit で `router.push('/search?q=' + encodeURIComponent(value))`。
- 空 / 空白のみは submit しない (`trimmed === '' なら return`)。
- 演算子ヘルプは `<details>` で折りたたみ表示。autosuggest popup は未実装 (TODO)。

### 4.3 SEO

- `metadata` に `title`, `description` を設定。
- 検索結果ページは Google 等のクローラに公開 (未ログインで閲覧可能)。
- パラメータ無し (`/search`) は CTA のみで noindex 推奨だが現状未指定 (TODO)。

---

## 5. 実装対応方針

### 5.1 バックエンド

- `apps/search/parser.py` は **クエリ文字列 → ParsedQuery dataclass** の純関数。例外を投げない。テストしやすい。
- `apps/search/services.py::search_tweets` は ParsedQuery を QuerySet にマッピング。Tweet model の filter を組み立てるだけ。
- `apps/search/views.py::SearchView` は API の thin wrapper。AllowAny。limit クランプのみここで担当。
- 削除済み tweet は `Tweet.objects` (default Manager) が `is_deleted=False` 行のみ返すので、自動的に除外される。
- pg_bigm / pg_trgm extension は migration `0002_create_postgres_extensions.py` で `CREATE EXTENSION IF NOT EXISTS pg_bigm` を実行。Postgres 以外 (sqlite テスト) は migration が no-op。
- 関連 Tag は pg_trgm GIN index で `tag.name LIKE` を加速 (`tag:` 演算子向けの将来最適化、現状は等価一致 `tag__name=`)。

### 5.2 フロントエンド

- `client/src/lib/api/search.ts::fetchSearch` は SSR fetch (cookie 込み)。client component から使う場合は `api` axios instance 経由に switch。
- `SearchBox` は controlled state、debounce 無し。submit 時のみ navigate。
- 結果ページの list レンダリングは **stable**: 同じ q で再 navigate しても順序がブレない (新着順 + id tiebreaker)。
- 演算子の autosuggest は将来追加 (TODO)。

### 5.3 Tombstone・Block

- 削除済み tweet は default Manager で除外。`is_deleted=True` の tweet が結果に出ない。
- 元 tweet が削除された QUOTE / REPLY tweet は結果に出る (= alive 行が残っているので)。`html` 内の埋め込みカードがフロントで placeholder にレンダされる。
- Block 関係は **検索結果には反映しない** (前述 §3.4)。

### 5.4 Rate limit / DDOS

- `anon` scope は本番 200/day。未ログインクローラが暴走したらここでブロック。
- 検索専用の scope (例: `search_anon`, `search_user`) を導入するかは別 issue。MVP は default で問題なし。

---

## 6. 参考

### 内部参照

- [docs/SPEC.md §10](../SPEC.md) (検索機能仕様)
- [docs/adr/0002-search-infrastructure.md](../adr/0002-search-infrastructure.md) (pg_bigm vs Meilisearch PoC)
- [apps/search/parser.py](../../apps/search/parser.py)
- [apps/search/services.py](../../apps/search/services.py)
- [apps/search/views.py](../../apps/search/views.py)
- [apps/search/urls.py](../../apps/search/urls.py)
- [apps/search/tests/test_parser.py](../../apps/search/tests/test_parser.py)
- [apps/search/tests/test_services.py](../../apps/search/tests/test_services.py)
- [client/src/app/(template)/search/page.tsx](<../../client/src/app/(template)/search/page.tsx>)
- [client/src/components/search/SearchBox.tsx](../../client/src/components/search/SearchBox.tsx)
- [client/src/lib/api/search.ts](../../client/src/lib/api/search.ts)

### 関連 Issue / PR

- P2-01 (#204): 検索 PoC (pg_bigm + Lindera vs Meilisearch ベンチマーク)
- P2-02 (#177): pg_bigm / pg_trgm CREATE EXTENSION migration
- P2-11 (#205): apps/search 実装
- P2-12 (#206): 検索 API 演算子
- P2-16 (#207): 検索画面 UI

### 関連ドキュメント

- [search-scenarios.md](./search-scenarios.md) — 日本語シナリオ集
- [search-e2e-commands.md](./search-e2e-commands.md) — E2E 実行コマンド
