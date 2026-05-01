# Phase 2: TL・リアクション・フォロー・検索 — Issue 一覧ドラフト

> Phase 目標: フォロー → アルゴリズム TL → リアクション → 検索 までの「読む側」体験を完成させる
> マイルストーン: `Phase 2: TL・リアクション・フォロー・検索`
> 見積工数: 18〜22 日 — **worktree 並列 2〜4 本前提**。直列換算だと約 32 日なので並列化が必須。
> バージョン: **v2** (architect / security-reviewer / database-reviewer 並列レビュー反映)
> 並列化: 全文検索 PoC (P2-01) と F-15 内包の extension migration (P2-02) 完了後、follows / reactions / Tweet 拡張 / OGP は独立で 4 worktree 並列可。TL (P2-08) のみ依存が大きく直列気味。
>
> v1 → v2 主要変更（レビュー指摘反映）:
>
> - **arch C-1**: P2-08 で **SPEC §5.1 更新タスク**を追加（fan-out-on-read を SPEC に正式採用、ADR-0004 起票）
> - **arch C-2**: P2-01 受入基準に **SPEC §10.2 / ER §3 のドキュメント更新 PR** を追加（PoC 結果反映）
> - **db C-1**: ER.md §2.5 で `repost_of` を **CASCADE → SET_NULL** に修正（連鎖物理削除リスク）
> - **db C-2**: P2-08 着手前に **`EXPLAIN ANALYZE`** で TL build クエリのインデックスヒット確認、必要なら `(created_at DESC, author_id)` 複合 index 追加
> - **sec CRITICAL #1**: P2-07 SSRF 対策を **httpx + カスタム transport (TCP 接続後 IP 検証)** に強化、IPv6 ULA / link-local / `file://` / `gopher://` 禁止
> - **sec CRITICAL #2**: P2-13 で **DOMPurify によるクライアント側 sanitize** を必須要件に明記
> - **sec HIGH**: P2-03 / P2-04 / P2-06 の Block チェックを**双方向**に変更
> - **db H-1**: P2-03 / P2-04 / P2-05 の signals を **`transaction.on_commit`** + 日次 reconciliation Beat に変更
> - **db H-2 / arch H-1**: P2-04 リアクション種別変更を **UPDATE-not-DELETE**、`get_or_create` + `IntegrityError` ハンドリング、scoped throttle 10/min/tweet 追加
> - **arch H-2**: P2-08 Repost 重複時の **tie-breaker**（最初に出現した行の `created_at` を採用）と pytest ケース追加
> - **db H-4**: P2-09 で **`tweet_tag(tweet_id)` index 追加 migration** を作業内容に含める
> - **arch H-4**: P2-19 sticky banner を **CLS 0 保証**（intersection で挿入）
> - **本セッション実装範囲**: P2-01 / P2-11 / P2-12（検索系 3 件）は PoC 完了後の別セッションに先送り。本セッションは **P2-02〜P2-10 backend** + **P2-13〜P2-19 frontend**（検索画面 P2-16 除く）+ **P2-20〜P2-22 QA/デプロイ**。

## 依存グラフ (簡略版)

```
Phase 1 完了 (Tweet / Tag / User モデル本実装済み、CookieAuth 配線済み)
  │
  ├──▶ P2-01 全文検索 PoC (pg_bigm + Lindera vs Meilisearch、ADR-0002 を Decision に昇格)
  │     │
  │     └──▶ P2-11 apps/search 実装 (PoC 結果に応じてバックエンド選択)
  │
  ├──▶ P2-02 pg_bigm / pg_trgm CREATE EXTENSION migration (F-15 内包、P2-01 のベンチに必要)
  │
  ├──▶ P2-03 apps/follows モデル + API (Follow, no_self_follow, unique_follow)
  │     │
  │     └──▶ P2-08 TL 配信 (フォローグラフ参照)
  │     │
  │     └──▶ P2-10 おすすめユーザー API
  │
  ├──▶ P2-04 apps/reactions モデル + API (10 種、unique_user_tweet_reaction)
  │     │
  │     └──▶ P2-08 TL 配信 (全体 30% は reaction_count 依存)
  │     │
  │     └──▶ P2-09 トレンドタグ集計 (24h reaction 重み付け)
  │
  ├──▶ P2-05 Tweet モデル拡張 activate (Repost / Quote / Reply フィールド + signals)
  │     │
  │     └──▶ P2-06 Repost / Quote / Reply API
  │           │
  │           └──▶ P2-08 TL 配信 (Repost を fan-out 対象に含める)
  │
  ├──▶ P2-07 OGP カード自動取得 (Celery、24h Redis cache、OgpCache モデル)
  │     │
  │     └──▶ P2-15 RT / 引用 RT / リプライ UI (OGP プレビュー使用)
  │
  ├──▶ P2-08 TL 配信 (70:30 fan-out-on-read + Redis ZSET、ヒット率 85% 目標)
  │     │
  │     ├──▶ P2-13 ホーム TL UI (アルゴリズム / フォロー中タブ)
  │     └──▶ P2-19 未ログイン /explore
  │
  ├──▶ P2-09 トレンドタグ集計 (Celery Beat 30min、Redis `trending:tags`)
  │     │
  │     └──▶ P2-17 トレンドタグ / おすすめユーザーサイドバー
  │
  ├──▶ P2-10 おすすめユーザー API (興味タグ → リアクション履歴 → フォロワー数)
  │     │
  │     └──▶ P2-17 サイドバー
  │
  ├──▶ P2-11 apps/search 実装 (バックエンド = pg_bigm or Meilisearch)
  │     │
  │     └──▶ P2-12 検索 API (tag:/from:/since:/until:/type:/has: 演算子) + signals 同期
  │           │
  │           └──▶ P2-16 検索画面 UI
  │
  └──▶ Frontend (P2-08 / P2-12 完了後並列可)
        P2-13 ホーム TL UI (アルゴリズム / フォロー中)
        P2-14 リアクション UI (10 種 + Alt+Enter キーボード代替)
        P2-15 RT / 引用 RT / リプライ UI
        P2-16 検索画面 UI
        P2-17 トレンドタグ / おすすめユーザーサイドバー
        P2-18 「もっと見る」展開 (X 準拠、長文・コードブロック・画像)
        P2-19 未ログイン用 /explore

統合・QA:
  P2-20 pytest カバレッジ 80% gate (Phase 2 範囲)
  P2-21 E2E シナリオ (Playwright) — フォロー → リアクション → TL 反映 → 検索
  P2-22 Phase 2 stg デプロイ + 動作確認
```

---

## P2-01. [research][backend] 全文検索 PoC: pg_bigm + Lindera vs Meilisearch ベンチマーク (ADR-0002 更新)

- **Labels**: `type:research`, `layer:backend`, `area:search`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (1-2d、Phase 2 冒頭の 1〜2 日スパイク)
- **Parallel**: なし (Phase 2 着手の前提、P2-11/P2-12 のバックエンド選択を確定させる)
- **Depends on**: Phase 1 完了 (Tweet モデル / シードツイートが揃っている前提), P2-02 (pg_bigm extension が enable されている)

### 目的

ARCHITECTURE §4.3 / ADR-0002 では「pg_bigm + Lindera を MVP 仮採用、Phase 2 冒頭で日本語検索精度を 1〜2 日スパイクして判断」と定めている。本 Issue でその PoC を実施し、**コードスニペット混じりの日本語ツイート**で要件を満たすかを実データで検証する。判定結果を ADR-0002 の Status を `Proposed` → `Accepted` (pg_bigm) または `Superseded by Meilisearch` に確定させる。

### 作業内容

- [ ] **PoC データセット作成**:
  - 1,000 件規模の合成ツイート (Phase 1 のシードツイートを Faker + LLM で増幅)
  - 内訳: 日本語ベタ書き 40% / 英日混在 30% / コードブロック含み 20% / URL 含み 10%
  - 検索クエリセット 50 本を作成 (フォーカス: 日本語名詞、英単語、フレーズ、コード断片)
- [ ] **候補 A: pg_bigm + Lindera**:
  - `apps/common/migrations/0001_extensions.py` (P2-02) で `pg_bigm` enable 済み前提
  - `django-bigm` または raw `LIKE '%xxx%'` + bigm GIN index でクエリ
  - Lindera を Django 側で Python wrapper (`lindera-py`) として呼び出し、検索前に N-gram トークナイズ
  - インデックス作成時間 / クエリ p95 latency / 関連度精度を測定
- [ ] **候補 B: Meilisearch**:
  - `local.yml` に Meilisearch v1.x サービス追加 (PoC 中のみ)
  - `meilisearch-python-sdk` で 1,000 件を bulk index
  - 同じ 50 本のクエリで p95 latency / 関連度精度を測定
- [ ] **評価軸** (`docs/research/0002-search-poc-result.md` に記録):
  - 関連度: 上位 10 件中の妥当 hit 数を人手評価 (各クエリ 3 名で blind 採点)
  - 性能: クエリ p95 < 200ms 達成可否
  - 運用: 追加 EC2 (Meilisearch on EC2 `t4g.small` +$20/月) のコストを払う価値があるか
  - 開発: Django signals 連携の手間
- [ ] **判定基準**:
  - pg_bigm の関連度精度が Meilisearch の **80% 以上** ならば pg_bigm 採用
  - 80% 未満なら Meilisearch 採用 → ARCHITECTURE §3.2 / §4.3 / 予算表を修正
- [ ] **ADR-0002 更新**:
  - Status: `Proposed` → `Accepted` (採用バックエンドを明記)
  - 数値で判定根拠を残す (関連度 X%、p95 Yms、月額 Z 円)
  - Loser 側は「将来再検討する条件」を明記 (例: 月間検索数が N を超えたら Meilisearch 再評価)
- [ ] PoC 用コード (`apps/search/poc/`) は merge 前に **delete**、ADR と数値表のみ残す

### 受け入れ基準

- [ ] `docs/adr/0002-fulltext-search-backend.md` の Status が `Accepted` に変わり、判定数値が記録されている
- [ ] 採用バックエンドが ROADMAP / ARCHITECTURE と矛盾しない (両方を更新)
- [ ] **arch C-2**: 採用結果に応じて `docs/SPEC.md §10.2` と `docs/ER.md §3` の検索バックエンド記載を**別 PR で更新** (SPEC は Meilisearch 前提で書かれているので pg_bigm 採用時は要修正)
- [ ] PoC 用 50 クエリの実行ログ (CSV) が `docs/research/0002-search-poc-result.md` に attach されている
- [ ] PoC 用ブランチ / コードはマージから除外 (ADR と数値表のみ main 反映)
- [ ] 採用結果が P2-11 / P2-12 の実装方針として確定 (依存タスクが unblock)

---

## P2-02. [feature][backend] pg_bigm / pg_trgm CREATE EXTENSION migration (F-15 内包)

- **Labels**: `type:feature`, `layer:backend`, `area:search`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-01 と同時進行可 (PoC のベンチに必要なため最速 merge)
- **Depends on**: Phase 0.5 (RDS parameter group で `shared_preload_libraries = pg_bigm,pg_stat_statements` が設定済み)

### 目的

`docs/issues/phase-0.5-followups.md` の **F-15** をここに内包。RDS parameter group では `shared_preload_libraries` 設定済だが、extension 自体の作成は Django migration で行う必要がある。P2-01 の PoC ベンチや P2-11 検索バックエンド実装の前提となる。

### 作業内容

- [ ] `apps/common/migrations/0001_extensions.py` を新規作成:

  ```python
  from django.contrib.postgres.operations import BigmExtension, TrigramExtension
  from django.db import migrations

  class Migration(migrations.Migration):
      initial = True
      operations = [
          BigmExtension(),
          TrigramExtension(),
      ]
  ```

- [ ] `requirements/base.txt` に `django.contrib.postgres` 経由で利用するため特に追加 deps なし、ただし local 開発の `compose/local/postgres/Dockerfile` で `postgresql-15-pg-bigm` を apt install 済みか確認 (Phase 0.5 で既に対応していれば不要)
- [ ] CI の Postgres image (`docker.io/groonga/pgroonga` などではなく) `postgis/postgis:15-3.4` または独自 build を使うため、`.github/workflows/ci.yml` の services を pg_bigm 同梱 image に切替
- [ ] pytest: `test_extensions.py` で `cur.execute("SELECT extname FROM pg_extension WHERE extname IN ('pg_bigm','pg_trgm')")` が 2 行返ることを確認
- [ ] ローカル `make migrate` で extension 有効化を確認

### 受け入れ基準

- [ ] `python manage.py migrate` で extension が有効化される (冪等)
- [ ] `SELECT extname FROM pg_extension;` に `pg_bigm` / `pg_trgm` が含まれる
- [ ] CI の Postgres コンテナでも同様に通る
- [ ] phase-0.5-followups.md の F-15 を `[x] 完了 (P2-02 で対応)` に更新

---

## P2-03. [feature][backend] apps/follows モデル + フォロー API (POST/DELETE + 一覧)

- **Labels**: `type:feature`, `layer:backend`, `area:follows`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-04, P2-05, P2-07 と並列可 (互いに依存しない)
- **Depends on**: Phase 1 完了 (User 拡張モデル)

### 目的

ER §2.4 の Follow モデルを実装し、SPEC §18.1 の「フォロー / アンフォロー」を完動させる。TL (P2-08) とおすすめユーザー (P2-10) の前提となるフォローグラフを提供する。

### 作業内容

- [ ] `apps/follows/` を新規作成 (`models.py`, `views.py`, `serializers.py`, `urls.py`, `apps.py`, `admin.py`, `tests/`)
- [ ] `apps/follows/models.py`:
  ```python
  class Follow(TimeStampedModel):
      follower = models.ForeignKey(User, on_delete=CASCADE, related_name="following_set")
      followee = models.ForeignKey(User, on_delete=CASCADE, related_name="follower_set")
      class Meta:
          constraints = [
              models.UniqueConstraint(fields=["follower","followee"], name="unique_follow"),
              models.CheckConstraint(check=~Q(follower=F("followee")), name="no_self_follow"),
          ]
          indexes = [
              models.Index(fields=["follower","-created_at"]),
              models.Index(fields=["followee","-created_at"]),
          ]
  ```
- [ ] `INSTALLED_APPS` に `apps.follows` を追加、`config/urls.py` に `path("api/v1/", include("apps.follows.urls"))`
- [ ] **API 設計** (handle ベースで RESTful、SPEC §16.2 と整合):
  - `POST   /api/v1/users/<handle>/follow/` → Follow 作成 (idempotent: 既にフォロー中なら 200, 新規なら 201)
  - `DELETE /api/v1/users/<handle>/follow/` → Follow 削除 (存在しなければ 404)
  - `GET    /api/v1/users/<handle>/followers/?cursor=...` → フォロワー一覧 (cursor pagination, 20 件/page)
  - `GET    /api/v1/users/<handle>/following/?cursor=...` → フォロー中一覧
- [ ] **signals** (db H-1: `transaction.on_commit` で commit 後発火、ロールバック時の drift 防止):
  - `post_save` を `transaction.on_commit(lambda: User.objects.filter(pk=...).update(followers_count=F("...") + 1))` に変更
  - `post_delete` 同様、`F("...") - 1` + `GREATEST(... - 1, 0)` ガード
  - **reconciliation Beat**: 日次 (深夜 02:30 JST) で `apps.follows.tasks.reconcile_counters` が `SELECT COUNT(*) FROM follow GROUP BY follower_id` で実態と照合し drift を補正
- [ ] **ブロック関係チェック** (SPEC §14.2、sec HIGH: **双方向**): `Block.objects.filter(Q(blocker=follower, blockee=followee) | Q(blocker=followee, blockee=follower)).exists()` で 403
- [ ] **通知発火**: Follow 作成時に `Notification(kind=FOLLOW, recipient=followee, actor=follower)` を作成 (Phase 4 で apps/notifications 本実装、ここでは ImportError 回避のため try/except 経由で疎結合)
- [ ] pytest: 200/201/204/400/403/404 + 自己フォロー試行 + 重複フォロー試行 + ブロック関係 + counters の整合性 (10+ ケース)

### 受け入れ基準

- [ ] 同一 (follower, followee) ペアで 2 回 POST しても DB レコードは 1 件
- [ ] 自分自身を follow する POST は 400 (CheckConstraint で DB レベルでも reject)
- [ ] `User.followers_count` / `following_count` が follow / unfollow で正しく増減
- [ ] ブロック相手をフォローしようとして 403
- [ ] cursor pagination が 20 件単位で動作、`next` URL が機能

---

## P2-04. [feature][backend] apps/reactions モデル + API (10 種 / 1 user 1 tweet 1 種)

- **Labels**: `type:feature`, `layer:backend`, `area:reactions`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-03, P2-05, P2-07 と並列可
- **Depends on**: Phase 1 完了 (Tweet モデル本実装済み)

### 目的

ER §2.9 の Reaction モデル + SPEC §6 の 10 種固定絵文字セット (`like / interesting / learned / helpful / agree / surprised / congrats / respect / funny / code`) を実装。1 ユーザー 1 ツイートに 1 種類のみで、再押下で取消、別種に変えると自動で前のリアクションを取り消す X 式仕様を実装する。

### 作業内容

- [ ] `apps/reactions/` を新規作成 (models.py, views.py, serializers.py, urls.py, apps.py, admin.py, tests/)
- [ ] `apps/reactions/models.py`:
  - `class ReactionKind(TextChoices)`: SPEC §6.2 の 10 種 (列挙値は SPEC のキーと一致)
  - `class Reaction(TimeStampedModel)`: user FK / tweet FK / kind, `UniqueConstraint(user, tweet)` (種別違いの 2 件目を防ぐため kind は constraint に含めない), Index `(tweet, kind)` と `(user, -created_at)`
- [ ] **API** (arch H-1: 種別変更は **UPDATE-not-DELETE** で signals 二重発火を防ぐ):
  - `POST   /api/v1/tweets/<id>/reactions/` body=`{kind}` → 作成 / 種別変更 / 取消 を **upsert toggle** で表現
    - 既存なし & 新規 → INSERT + 201 + `{kind}` (`reaction_count` +1)
    - 既存 = リクエストの kind → DELETE → 200 + `{kind: null}` (`reaction_count` -1)
    - 既存 ≠ リクエストの kind → **UPDATE のみ** (DELETE→INSERT ではなく `Reaction.kind` を書き換え) → 200 + `{kind: new}` (`reaction_count` 不変、signals は `update_fields` を見て kind 変更時には何もしない)
  - `DELETE /api/v1/tweets/<id>/reactions/` → 明示的取消 (存在しなければ 404)
  - `GET    /api/v1/tweets/<id>/reactions/` → 集計 `{kind: count, ...}` + 自分の現在の kind (auth時のみ)
- [ ] **race condition 対策** (db H-2):
  - `select_for_update()` は既存行のみロックし**新規 INSERT には効かない**ため、`get_or_create()` + `IntegrityError` ハンドリング (重複 INSERT を 200 idempotent に変換) を採用
  - 種別変更時のみ `select_for_update()` で行ロック取得 → `kind` フィールド update
- [ ] **signals** (db H-1: `transaction.on_commit` でコミット後発火):
  - `post_save` で `update_fields is None` または `"kind" not in update_fields` のときのみ `Tweet.reaction_count = F("reaction_count") + 1` (種別変更のみの save は signal で count 触らない)
  - `post_delete` で `F("reaction_count") - 1` + `GREATEST(... - 1, 0)` ガード
  - 種別ごとの集計は P2-09 (トレンド) で別途、ここでは合計のみ
  - **reconciliation Beat**: 日次で `Tweet.reaction_count` を `SELECT COUNT(*) FROM reaction GROUP BY tweet_id` と照合
- [ ] **通知発火**: 自ツイートへの新規リアクションで `Notification(kind=LIKE)` (Phase 4 で本実装、ここは疎結合 try/except)
- [ ] **モデレーション** (sec HIGH: **双方向 Block**): `Block.objects.filter(Q(blocker=user, blockee=tweet.author) | Q(blocker=tweet.author, blockee=user)).exists()` で 403
- [ ] **rate limit** (sec MEDIUM: スパム対策): DRF `ScopedRateThrottle` で `reactions: 10/min per user` (per-tweet ではなく per-user で十分、`ScopedRateThrottle` の scope に `tweet_id` を含めない)
- [ ] pytest: 10 種すべての post / 取消 / 種別変更 / 重複 / 並行 toggle (threading.Lock + transaction で確認) / ブロック越え / 削除済みツイートへの試行 (12+ ケース)

### 受け入れ基準

- [ ] `like` を POST → `like` を再 POST で取消 (`reaction_count` が +1 → 0)
- [ ] `like` POST 後 `learned` POST → 既存の `like` が消えて `learned` が残る (`reaction_count` は 1 のまま)
- [ ] 同時 2 リクエストで race condition 起こさず最終 state が一意
- [ ] ブロック相手のツイートに POST → 403
- [ ] `GET /reactions/` の集計が DB の実態と一致

---

## P2-05. [feature][backend] Tweet モデル拡張 activate (Repost / Quote / Reply) + signals

- **Labels**: `type:feature`, `layer:backend`, `area:tweets`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-03, P2-04, P2-07 と並列可
- **Depends on**: Phase 1 P1-07 (Tweet モデル本体)

### 目的

Phase 1 で「フィールドだけ用意してロジックは Phase 2」とした `reply_to` / `quote_of` / `repost_of` / `TweetType` の REPLY/REPOST/QUOTE を有効化。シリアライザ・バリデーション・カウンタ signals を整備し、P2-06 の API がモデル層で安全に動く状態にする。

### 作業内容

- [ ] **TweetType の値域拡張**: 既に Phase 1 で enum 定義済みなので、`TweetSerializer.validate_type` で Phase 1 では `original` のみ受け付けていた制限を解除し、`reply / repost / quote` を許可
- [ ] **ER.md §2.5 整合**: db C-1 で `repost_of` を `CASCADE → SET_NULL` に修正済み。本 Issue の migration で既存 Tweet テーブルの FK 制約を `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... ON DELETE SET NULL` で書き換え。**`type=repost` AND `repost_of IS NULL`** のレコードは表示側で「元ツイートが削除されました」tombstone 化（serializer で判定）
- [ ] **`repost_has_empty_body` CheckConstraint** (ER §2.5):
  - `body == ""` のとき type=repost のみ許可、それ以外の type で空 body は reject
  - migration で DB 制約を追加
- [ ] **追加バリデーション** (Serializer 層):
  - `reply` のとき `reply_to` 必須、`quote` のとき `quote_of` 必須、`repost` のとき `repost_of` 必須
  - 自己 reply / 自己 quote はバリデーションで弾く (`reply_to.author == request.user` でも投稿は許可するが、循環防止のため再帰深さは serializer 層では検査せず DB スキャンも不要)
  - 削除済みツイートへの reply/quote/repost は 400 (`reply_to` が `SET_NULL` で null になっていれば検出可能)
- [ ] **signals** (`apps/tweets/signals.py`、db H-1: `transaction.on_commit` でコミット後発火):
  - `post_save` で `transaction.on_commit(lambda: <FK_target>.objects.filter(...).update(<count>=F("...") + 1))` で `repost_count` / `quote_count` / `reply_count` をアトミック増分
  - `post_delete` 同様、`F-1` (GREATEST 0 ガード)
  - signals は `apps/tweets/apps.py:ready()` で `connect`
  - **reconciliation Beat**: 日次で `Tweet.reply_count` 等を実態と照合 (P2-03 / P2-04 と同じ枠組み)
- [ ] **重複 RT の禁止**:
  - 同一 user × 同一 `repost_of` の Tweet は 1 件のみ (UniqueConstraint を partial で `WHERE type='repost'`)
  - 重複 POST → 既存 repost を返す (200 idempotent)
- [ ] **通知発火**:
  - `reply` → 元ツイート著者に `Notification(kind=REPLY)`
  - `repost` → 元ツイート著者に `Notification(kind=REPOST)`
  - `quote` → 元ツイート著者に `Notification(kind=QUOTE)`
  - すべて Phase 4 本実装まで疎結合 (try/except で ImportError 許容)
- [ ] pytest: 各 type の作成 / カウンタ整合 / 削除時のカウンタデクリメント / 自己 reply / 削除済み参照 / 重複 RT / 並行 RT race (10+ ケース)

### 受け入れ基準

- [ ] `type=repost` で `body=""` 以外は 400
- [ ] reply / quote / repost で対応 FK 必須、欠落で 400
- [ ] 同一ユーザーが同じツイートを 2 回 RT しても DB レコードは 1 件
- [ ] reply / quote / repost を作成すると元ツイートの該当 count が +1
- [ ] その reply / quote / repost を削除すると元ツイートの該当 count が -1
- [ ] migration で既存 ORIGINAL ツイートに影響しない (down/up が冪等)

---

## P2-06. [feature][backend] Repost / Quote / Reply API

- **Labels**: `type:feature`, `layer:backend`, `area:tweets`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-03, P2-04, P2-07 と並列可だが P2-05 の後段
- **Depends on**: P2-05

### 目的

SPEC §3.2-§3.4 のツイートタイプ別エンドポイントを提供。既存 `POST /api/v1/tweets/` は `type=original` のみだったが、Phase 2 で `reply / repost / quote` を解禁する。

### 作業内容

- [ ] **API 設計** (RESTful、リソースは Tweet、type で sub-action を表現):
  - `POST /api/v1/tweets/<id>/repost/` → 自分による Repost を作成 (`type=repost`, `repost_of=<id>`, body=空)
    - 既に RT 済みなら 200 + 既存 Repost の id (idempotent)
  - `DELETE /api/v1/tweets/<id>/repost/` → 自分の Repost を削除 (`reply_count` 等のカウンタ自動 -1)
  - `POST /api/v1/tweets/<id>/quote/` body=`{body, tag_ids[], image_ids[]}` → Quote 作成 (`quote_of=<id>`, body=自分のコメント 180 字)
  - `POST /api/v1/tweets/<id>/reply/` body=`{body, tag_ids[], image_ids[]}` → Reply 作成 (`reply_to=<id>`)
- [ ] **共通バリデーション** (P1-08 の作成 API と同等):
  - body 文字数 1〜180 (Premium 500), Markdown 文字数カウント (P1-10) 適用
  - tag は最大 3 個、image は最大 4 枚
  - URL があれば OGP 取得を Celery enqueue (P2-07 と連携)
- [ ] **特殊バリデーション**:
  - `repost`: body / images / tags は受け取らない (受け取っても無視 + warning)
  - `quote`: body 必須、quote_of は public ツイートのみ (削除済み・author ブロック中は 400/403)
  - `reply`: 元ツイートが reply の場合は thread とみなし `reply_to` を root ではなく直接親に
- [ ] **モデレーション** (sec HIGH: **双方向 Block**):
  - `Block.objects.filter(Q(blocker=request.user, blockee=tweet.author) | Q(blocker=tweet.author, blockee=request.user)).exists()` で 403
  - 元ツイート著者をミュート → ミュートしてても reply/quote/repost は可能 (ミュートは表示制御のみ)
- [ ] **TL 反映** (P2-08 fan-out-on-read のため、ここでは TL 直接 push しない、自分のフォロワーが読むときに自然に出現):
  - ただし Redis キャッシュ `tl:home:{user_id}` を invalidate (TTL 10 分なので最大 10 分待ち)
- [ ] pytest: 各エンドポイントの 200/201/400/403/404 + ブロック / ミュート / 削除済み参照 / 文字数超過 / Premium 500 字 (15+ ケース)

### 受け入れ基準

- [ ] Repost が idempotent (POST 2 回で 1 件)
- [ ] Quote の body が 180/500 字超で 400
- [ ] Reply で元ツイートの `reply_count` が +1
- [ ] Repost で元ツイートの `repost_count` が +1
- [ ] DELETE /repost/ で自分の Repost が消えてカウンタ -1
- [ ] ブロック相手のツイートへの Reply で 403

---

## P2-07. [feature][backend] OGP カード自動取得 (Celery、24h Redis cache、OgpCache モデル)

- **Labels**: `type:feature`, `layer:backend`, `area:tweets`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-03, P2-04, P2-05 と並列可
- **Depends on**: Phase 1 P1-07 (Tweet モデル), Phase 0.5 (Celery worker / Redis 配線済み)

### 目的

SPEC §3.5 の OGP カード生成。本文中の URL を検出 → 非同期 Celery タスクで OGP メタを取得し、24h キャッシュ。1 ツイートにつき最初の URL 1 件のみカード化。ER §2.10 の `OgpCache` モデルを実装し、TL / 詳細ページで埋め込み表示する。

### 作業内容

- [ ] `apps/tweets/models.py` に `OgpCache` を追加 (ER §2.10):
  ```python
  class OgpCache(TimeStampedModel):
      url_hash = models.CharField(max_length=64, unique=True)  # SHA-256 of normalized URL
      url = models.URLField()
      title = models.CharField(max_length=300, blank=True)
      description = models.TextField(blank=True)
      image_url = models.URLField(blank=True)
      site_name = models.CharField(max_length=200, blank=True)
      fetched_at = models.DateTimeField(auto_now=True)
  ```
- [ ] `apps/tweets/ogp.py`:
  - `extract_first_url(body: str) -> str | None` (Markdown / 本文混在に対応、`http(s)://...` 抽出、`http` / `https` **以外の scheme は reject**)
  - `normalize_url(url) -> str` (utm 系 query 除去 / scheme 大文字小文字統一)
  - `fetch_ogp(url) -> dict` を **`httpx` + カスタム `HTTPTransport`** で実装、タイムアウト 5s、UA は settings の `OGP_USER_AGENT` (デフォルト `SNS-OGP-Bot/1.0`) 経由
- [ ] **Celery タスク** `apps.tweets.tasks.fetch_ogp_for_tweet(tweet_id)`:
  - Redis `ogp:{url_hash}` を先にチェック (TTL 24h, ER §4 / SPEC §3.5)
  - hit なら即終了
  - miss なら HTTP fetch → OgpCache upsert → Redis にキャッシュ書き込み (TTL 24h)
  - エラー (4xx/5xx/timeout) 時は `OgpCache(title="", url=...)` で空レコード保存し再 fetch を抑制
- [ ] **Tweet 作成時のフック**: P2-06 / Phase 1 P1-08 の create に `transaction.on_commit(lambda: fetch_ogp_for_tweet.delay(tweet.id))` を追加
- [ ] **Tweet API 拡張**: serializer の `ogp` フィールドに OgpCache を inline (URL があれば、なければ `null`)
- [ ] **SSRF / セキュリティ対策** (sec CRITICAL: DNS rebinding 完全対策):
  - **scheme 制限**: `http` / `https` のみ許可、`file://` / `gopher://` / `dict://` / `ftp://` 等は早期 reject
  - **TCP 接続時 IP 検証**: `httpx` の `HTTPTransport` をサブクラス化し、`socket.create_connection` 直後に取得した実 peer IP を `ipaddress.ip_address(...).is_private / is_loopback / is_link_local / is_reserved / is_multicast` で判定（IPv4 と **IPv6 ULA `fc00::/7` / link-local `fe80::/10`** を統一処理）
  - **redirect 各 hop で再判定**: `httpx.Client(follow_redirects=False)` で 1 hop ずつ手動追跡、各 hop で URL → IP を再検証（最大 3 hop）
  - レスポンスサイズ上限 1MB (`response.iter_bytes()` で逐次読み込み、超過で abort)
  - Content-Type が `text/html` / `application/xhtml+xml` 以外なら早期 return (PDF / 画像直 link は OGP として扱わない)
  - **失敗時の動作**: SSRF reject / timeout / 4xx / 5xx すべて `OgpCache(title="", url=...)` で空レコード保存 (再 fetch 抑制)
- [ ] pytest:
  - 正常 OGP fetch (vcrpy で固定レスポンス)
  - 24h cache hit
  - SSRF 試行 (`http://127.0.0.1/admin`) を reject
  - timeout / 4xx / 5xx で empty cache 作成
  - URL 検出: Markdown link / plain URL / 末尾句読点を含む URL

### 受け入れ基準

- [ ] ツイート作成 → 数秒で OGP データが反映 (Celery worker 動作)
- [ ] 24h 以内の同一 URL は HTTP fetch を発生させない (Redis ヒット)
- [ ] `http://127.0.0.1` / `http://10.0.0.1` への OGP fetch を試みて 0 byte で skip
- [ ] 1MB を超えるレスポンスを途中で打ち切る
- [ ] 削除されたツイートに紐づく OGP も削除されない (URL ベースのキャッシュなので継続利用)
- [ ] **db M-1**: `OgpCache` の蓄積防止のため、Celery Beat で日次 (深夜 04:00 JST)、`fetched_at < now() - 7 days` AND **直近 7 日間にどの Tweet からも参照されなかった** url_hash を purge する `apps.tweets.tasks.purge_stale_ogp` を実装。参照判定は `Tweet.body` の URL 抽出のため重い → `OgpCache` に nullable `last_used_at` を追加し、Tweet 作成時に併せて touch する方式を採用。

---

## P2-08. [feature][backend] TL 配信 (70:30 fan-out-on-read + Redis ZSET、ヒット率 85% 目標)

- **Labels**: `type:feature`, `layer:backend`, `area:timeline`, `area:performance`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: L (1-2d)
- **Parallel**: P2-09, P2-10 と並列可だが P2-03/04/05/06 の後段
- **Depends on**: P2-03 (Follow), P2-04 (Reaction), P2-05 (Tweet 拡張), P2-06 (Repost で TL に出現)

### 目的

SPEC §5.1 のホーム TL 配信を実装。**フォロー 70% + 全体 30%**、重複除外、同著者 3 件まで、cursor pagination 20 件/page。ARCHITECTURE §4.1 / ADR の判断に従い **fan-out-on-read + Redis キャッシュ** 方式 (ユーザーアクセス時にオンデマンド計算、TTL 10 分)。RDS の burst credit 枯渇懸念に応えるため、Redis キャッシュヒット率 85% 以上を目標とする。

### 着手前作業 (arch C-1, db C-2)

- [ ] **SPEC §5.1 更新 PR**: SPEC §5.1 は Celery Beat 5 分プリビルドと記載 → 実装方針 (fan-out-on-read) に合わせて書き換え。本 Issue とは別 PR で先行 merge
- [ ] **ADR-0004 起票** `docs/adr/0004-timeline-strategy.md`: fan-out-on-read 採用根拠 (write-amp 回避、burst credit 保護、small-n ユーザーで十分)
- [ ] **EXPLAIN ANALYZE**: ローカルで `Tweet.objects.filter(author__in=Follow..., created_at__gte=...)` の query plan を確認、`(author, -created_at)` index で Index Scan が効くか検証。Seq Scan に落ちるなら `(created_at DESC, author_id)` 複合 index を追加 migration

### 作業内容

- [ ] `apps/timeline/` を新規作成 (services.py, views.py, urls.py, tasks.py, tests/)
- [ ] **アルゴリズム実装** `apps.timeline.services.build_home_tl(user, cursor=None, limit=20) -> list[Tweet]`:
  1. **フォロー候補 (70%)**: `Tweet.objects.filter(author__in=Follow.objects.filter(follower=user).values("followee"), created_at__gte=now-24h).order_by("-created_at")` の上位 N 件 (cursor 後 N=14)
     - Repost は `type=repost` で `repost_of` の元ツイートをフォロイーが RT した形で TL に出現
  2. **全体候補 (30%)**: `Tweet.objects.filter(created_at__gte=now-24h, type__in=[ORIGINAL,QUOTE], reaction_count__gt=0).order_by("-reaction_count","-created_at")` の上位 N 件 (cursor 後 N=6)
  3. **マージ + 重複除外** (arch H-2: tie-breaker 明記): 70% / 30% の比率を維持しながら time-mixing。同一 tweet_id を 1 件に集約する際、**最初に出現した行 (RT or 元) の `created_at` を採用**。`type=repost` で `repost_of` の元ツイートが同じ TL に既に出現している場合は、後から出現した方を drop
  4. **同著者連投 3 件まで**: `author_id` のフレークウェイト (run-length 制限)
  5. **ブロック / ミュート除外** (sec HIGH: **双方向 Block**): `Block.objects.filter(Q(blocker=user) | Q(blockee=user))` の関連 author を双方向で除外。`Mute.objects.filter(muter=user)` は片方向のみ
  6. cursor: `(timestamp_int, tweet_uuid)` を base64
- [ ] **Redis キャッシュ層** `tl:home:{user_id}` (ZSET, score = timestamp_int, member = tweet_id):
  - 構造: ZSET に最大 200 件 (10 ページ分相当) を pre-buffer
  - TTL: 10 分 (SPEC §5.1, ER §4)
  - 読み出し: `ZREVRANGEBYSCORE tl:home:{user_id} +inf <cursor_score> LIMIT 0 20`
  - キャッシュミス: 上記アルゴリズムで build → ZSET に書き込み → 返す
  - `tweet_id` から本体は `Tweet.objects.in_bulk` で一括 fetch + select_related(author) + prefetch (images, tags, ogp)
- [ ] **invalidate**:
  - 自分が follow / unfollow → 自分の `tl:home:{self.id}` を DEL (P2-03 signals)
  - フォローしているユーザーがツイート → そのフォロワー全員の TL は **invalidate しない** (fan-out-on-read のため、TTL 10 分で自然 refresh)
  - 自分がツイート → 自分の TL のみ invalidate
- [ ] **Cache stampede 対策** (sec HIGH): キャッシュ miss build を `redis SET tl:home:{user_id}:lock 1 NX EX 30` で同時 1 リクエストに制限。lock 取得失敗時は短い backoff (50ms × 3) してキャッシュ再読、それでも miss なら 503 で fallback (頻発したら build_latency_p95 SLO 違反として alert)
- [ ] **explore のブロック除外** (sec HIGH): `tl:explore` は全ユーザー共通だが、**読み出し時に閲覧者の Block 関係で post-filter** する (キャッシュには無 filter な候補集合を入れ、配信時に閲覧者ごとに `.exclude(author__in=blocked)`)。匿名アクセス時は filter 無し
- [ ] **API**:
  - `GET /api/v1/timeline/home/?cursor=...&limit=20` → アルゴリズム TL
  - `GET /api/v1/timeline/following/?cursor=...&limit=20` → フォロー中タブ (時系列のみ、フォロイーのツイートを `created_at` 降順)
  - 未ログインなら 401
- [ ] **未ログイン用 explore** (P2-19 と連携):
  - `GET /api/v1/timeline/explore/?cursor=...&limit=20` → 全体 reaction 数上位 24h (auth 不要)
  - キャッシュキー: `tl:explore` (全ユーザー共通、TTL 10 分)
- [ ] **メトリクス** (CloudWatch カスタムメトリクス):
  - `timeline.cache_hit_rate` (1 分粒度)
  - `timeline.build_latency_p95` (キャッシュミス時のビルド時間)
  - SLO: cache_hit_rate > 85%, build_latency_p95 < 500ms
- [ ] pytest:
  - 70:30 比率の検証 (フォローツイート 100 / トレンド 100 を仕込んで 20 件取得 → 14:6)
  - 同著者連投 5 件投下時に 3 件で打ち切り
  - ブロック相手のツイートが TL に出ない
  - ミュート相手のツイートが TL に出ない
  - 重複 (RT + 元ツイートが同フォロイー間に存在) で 1 件に集約
  - キャッシュ hit / miss の振る舞い (django-redis fake で検証)
  - cursor pagination 全 200 件を 10 ページで網羅できる
  - `/timeline/following/` は時系列のみで全体 30% を含まない

### 受け入れ基準

- [ ] `GET /timeline/home/` のレスポンスが 70:30 ± 10% に収まる
- [ ] 同著者の連続ツイートが 3 件で打ち切られる
- [ ] ブロック / ミュート / 自分のツイートを fan-out 対象外にする
- [ ] キャッシュ hit 時のレスポンスが p95 < 100ms
- [ ] キャッシュ miss build 時の p95 < 500ms
- [ ] follow / unfollow 直後に自分の TL が更新される (cache invalidate)
- [ ] CloudWatch metric `timeline.cache_hit_rate` が dashboard で見える

---

## P2-09. [feature][backend] トレンドタグ集計 (Celery Beat 30 分ごと、Redis `trending:tags`)

- **Labels**: `type:feature`, `layer:backend`, `area:tags`, `area:timeline`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-08, P2-10 と並列可
- **Depends on**: P2-04 (Reaction でスコア重み付け)

### 目的

SPEC §4.4 + ER §4 のトレンドタグ集計。過去 24h で付与回数の多いタグ Top 10 を Celery Beat で 30 分ごとに集計、Redis にキャッシュ。

### 作業内容

- [ ] **db H-4 / L-1: index 追加 migration**: `apps/tweets/migrations/00XX_tweet_tag_indexes.py` で `tweet_tag(tweet_id)` index を追加 (Django は FK に自動 index を作らない、24h 集計で全スキャン回避)。同時に `Block(blockee, blocker)` 逆引き index も追加 (db M-3)
- [ ] **Celery タスク** `apps.tags.tasks.aggregate_trending_tags()`:
  - SQL (db M-3: NULL 安全): `SELECT tag_id, COUNT(*) AS tag_uses_24h, COALESCE(SUM(t.reaction_count), 0) AS reactions FROM tweet_tag tt JOIN tweet t ON tt.tweet_id=t.id WHERE t.created_at >= now()-interval '24h' GROUP BY tag_id ORDER BY (tag_uses_24h + reactions*0.1) DESC LIMIT 10`
  - スコア = `tag_uses_24h + reactions * 0.1` (使用回数を主、リアクションを補助)
  - 結果を Redis `trending:tags` に JSON で保存 (TTL 30 分強の安全マージン: 35 分)
- [ ] **Celery Beat schedule** (`config/settings/base.py CELERY_BEAT_SCHEDULE`):
  ```python
  CELERY_BEAT_SCHEDULE = {
      "aggregate-trending-tags": {
          "task": "apps.tags.tasks.aggregate_trending_tags",
          "schedule": crontab(minute="*/30"),
      },
  }
  ```
- [ ] **API**:
  - `GET /api/v1/tags/trending/` → Redis `trending:tags` を返す (キャッシュ miss なら同期実行 fallback、ただし重い場合は warning)
  - 未ログインで利用可能 (SEO / explore で使うため)
- [ ] **シリアライザ**: `[{tag: {name, display_name, usage_count}, score, rank}]`
- [ ] pytest:
  - 24h 内タグ集計が正しい (Tweet x 3 with same tag → top 1)
  - 24h 超は除外
  - Redis キャッシュ書き込み確認
  - キャッシュ miss 時の fallback (eager mode で同期実行)

### 受け入れ基準

- [ ] Celery Beat 起動 30 分後に Redis にトレンドが反映
- [ ] `GET /api/v1/tags/trending/` が 200 で 10 件以下を返す
- [ ] 24h 経過したツイートのタグはランキングに含まれない
- [ ] 該当データが空でも 200 (空配列) を返す

---

## P2-10. [feature][backend] おすすめユーザー API (興味タグ → リアクション履歴 → フォロワー数)

- **Labels**: `type:feature`, `layer:backend`, `area:follows`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-08, P2-09 と並列可
- **Depends on**: P2-03 (Follow), P2-04 (Reaction)

### 目的

SPEC §5.3 のおすすめユーザー (Who to follow) を実装。興味関心タグ → リアクション履歴 → 全体フォロワー数の優先順で候補を返す。Celery Beat で 1 時間ごとに更新。

### 作業内容

- [ ] **Celery タスク** `apps.follows.tasks.compute_who_to_follow(user_id)`:
  1. **興味タグマッチ**: `User.interest_tags` がある場合、同じタグでツイート数の多いユーザー上位 30 件
  2. **リアクション履歴**: 興味タグが空 or 候補不足の場合、自分が直近 30 日にリアクションしたツイートの著者 top reaction-receivers
  3. **フォロワー数**: 上記でも候補 5 件未満なら `User.objects.order_by("-followers_count")` の上位
  4. **除外**: 既にフォロー中 / 自分自身 / ブロック関係 / Bot ユーザー (`is_bot=True`) を除外
  5. 結果上位 10 件を Redis `who_to_follow:{user_id}` に JSON 保存 (TTL 60 分, ER §4)
- [ ] **Celery Beat schedule**: 1 時間ごと、ただし全ユーザー一斉ではなく **lazy compute** (API 初回アクセス時に build, TTL 60 分)
  - 全ユーザー一斉だと t4g.micro が burst credit を吐く (M-2 懸念)、lazy + TTL で平準化
- [ ] **API**:
  - `GET /api/v1/users/recommended/?limit=10` → ログインユーザーへの recommendation
  - `GET /api/v1/users/popular/?limit=10` → 未ログイン用 (フォロワー数 top のみ、explore で使う)
- [ ] **シリアライザ**: `[{user: {handle, display_name, avatar, bio, followers_count}, reason: "shared_tag" | "recent_reaction" | "popular"}]` (フロントで「あなたが Python に興味があるから」など表示用)
- [ ] pytest:
  - 興味タグ 1 個 + 同タグ持ちユーザー 5 名 → 5 名が候補化
  - 既フォロー / 自分 / ブロックを除外
  - 興味タグ空 + リアクション履歴あり → reaction 著者から候補化
  - すべて空 → followers_count 上位
  - Redis キャッシュ TTL 60 分

### 受け入れ基準

- [ ] 自分自身が候補に出ない
- [ ] 既にフォローしているユーザーが候補に出ない
- [ ] 興味タグ Python があるユーザーには Python 多投ユーザーが優先表示
- [ ] reason フィールドが UI で表示できる粒度で返る
- [ ] キャッシュヒット時 p95 < 100ms

---

## P2-11. [feature][backend] apps/search 実装 (PoC 結果に応じて pg_bigm or Meilisearch)

- **Labels**: `type:feature`, `layer:backend`, `area:search`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: L (1-2d)
- **Parallel**: P2-12 とは順序関係 (こちら先), P2-08/09/10 と並列可
- **Depends on**: P2-01 (PoC で採用バックエンド確定), P2-02 (extension)

### 目的

P2-01 で確定した検索バックエンド (pg_bigm + Lindera または Meilisearch) を実装し、Repository Pattern で抽象化する。Phase 後半で他バックエンドへ swap する余地を残す。

### 作業内容

- [ ] `apps/search/` を新規作成 (backends/, services.py, signals.py, tasks.py, urls.py, views.py)
- [ ] **Repository Pattern** (`apps/search/backends/base.py`):
  ```python
  class SearchBackend(Protocol):
      def index(self, doc_type: str, doc_id: str, payload: dict) -> None: ...
      def delete(self, doc_type: str, doc_id: str) -> None: ...
      def query(self, doc_type: str, q: str, filters: dict, sort: str, limit: int, offset: int) -> SearchResult: ...
      def reindex_all(self, doc_type: str) -> None: ...
  ```
- [ ] **採用ケース A: pg_bigm** (`apps/search/backends/pg_bigm.py`):
  - GIN index を `body` / `tag_names_concat` カラムに作成 (`CREATE INDEX ... USING gin (body gin_bigm_ops)`)
  - クエリ時に Lindera で N-gram トークナイズ → `LIKE '%token%' AND LIKE '%token%'` に展開
  - Django ORM raw query で実装 (`Tweet.objects.extra(where=[...])`)
- [ ] **採用ケース B: Meilisearch** (`apps/search/backends/meili.py`):
  - `meilisearch-python-sdk` の `Client(host, api_key)` を ECS 環境変数経由
  - インデックス: `tweets`, `articles` (Article は Phase 6 で実装、ここではスキーマだけ準備)
  - インデックス設定 (ER §3.1):
    - `searchableAttributes: [body, author_display_name, author_handle, tag_names]`
    - `filterableAttributes: [author_id, author_handle, tag_names, type, created_at, has_image, has_code]`
    - `sortableAttributes: [created_at, reaction_count, repost_count]`
- [ ] **Django signals** (`apps/search/signals.py`):
  - `Tweet` の `post_save` → `index_document.delay(doc_type="tweet", id=...)`
  - `Tweet` の `post_delete` → `delete_document.delay(doc_type="tweet", id=...)`
  - `TweetTag` の `post_save/post_delete` → 親 Tweet の reindex
  - `TweetImage` の `post_save/post_delete` → 親 Tweet の reindex (`has_image` の更新)
- [ ] **Celery タスク** `apps.search.tasks.index_document(doc_type, id)`:
  - Tweet 本体 + author + tags + images をまとめて payload 構築
  - `has_image = images.exists()`, `has_code = "```" in body`
  - backend.index() を呼ぶ
- [ ] **日次 reindex タスク** (`apps.search.tasks.reindex_all`):
  - Celery Beat で日次 (深夜 03:00 JST)、`backend.reindex_all("tweet")` でバッチ整合性保証
- [ ] **設定切替**: `SEARCH_BACKEND = "pg_bigm" | "meilisearch"` を settings に置き、`get_backend()` で DI
- [ ] pytest:
  - signal で indexing が走る (eager Celery)
  - delete で document が消える
  - reindex_all が冪等
  - PoC で選ばなかった方の backend は smoke test レベルでも残しておく (将来 swap のため)

### 受け入れ基準

- [ ] Tweet 作成 → 数秒以内に検索 hit (eager + signal 動作)
- [ ] Tweet 削除 → 検索 hit から消える
- [ ] 日次 reindex でゴミ document が掃除される
- [ ] backend が DI で差し替え可能 (settings 切替で他 backend に向く)

---

## P2-12. [feature][backend] 検索 API (tag:/from:/since:/until:/type:/has: 演算子) + Django signals 同期

- **Labels**: `type:feature`, `layer:backend`, `area:search`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-08, P2-09, P2-10 と並列可だが P2-11 の後段
- **Depends on**: P2-11

### 目的

SPEC §10.3 の検索フィルタ演算子を実装。`tag:python` / `from:@taro` / `since:2026-01-01` / `until:2026-04-01` / `type:tweet` / `has:image` / `has:code` を組み合わせ可能にし、複合例 `kubernetes tag:k8s from:@taro since:2026-01-01` をパース。

### 作業内容

- [ ] **Query parser** (`apps/search/query_parser.py`):
  - 入力文字列を tokenize し、`(free_text, filters)` に分解
  - `tag:` (複数指定可、AND), `from:`, `since:`, `until:`, `type:tweet|article`, `has:image|code`
  - 不正な date は ParseError 400, 不正な type/has は warning + ignore
  - quote 引用 (`"exact phrase"`) はパースして `body` に substring match
- [ ] **API**:
  - `GET /api/v1/search/?q=...&sort=relevance|created_at&cursor=...&limit=20` → 検索結果
  - tab=`all|tweet|article`: 表示タブ (Article は Phase 6 で本実装、ここでは tweet のみ）
  - 未ログインで利用可 (SPEC §10.4)
- [ ] **シリアライザ**: 既存 Tweet serializer + `highlight` フィールド (検索語ハイライト HTML)
- [ ] **pagination**: cursor pagination (offset 方式は Meilisearch / pg_bigm 両方で性能劣化があるため `created_at + id` cursor)
- [ ] **モデレーション** (sec HIGH: **双方向 Block**): ブロック相手の Tweet は検索結果から除外 (post-filter, search backend ではなく ORM 側で `.exclude(author__in=Block.objects.filter(Q(blocker=user)|Q(blockee=user)).values("blocker_id","blockee_id"))`)
- [ ] **Injection 対策** (sec HIGH):
  - pg_bigm backend: `Tweet.objects.extra(where=["body LIKE %s"], params=[f"%{token}%"])` で **必ず `params` を分離**、`extra(where=[f"body LIKE '%{token}%'"])` のような文字列結合は禁止
  - Meilisearch backend: filter 文字列構築時に `value.replace("'", "''")` でシングルクォートエスケープ、ハンドル名の正規表現照合 (`^[a-zA-Z0-9_]{3,30}$`) で英数字のみ許容
- [ ] **rate limit** (sec MEDIUM: enumeration 対策): `anon: 10/min`, `user: 120/min` の Scoped throttle。`from:@<handle>` でハンドル存在判定で差が出ないよう、404 ではなく **空配列 200** を返す (匿名時のみ)
- [ ] pytest:
  - パーサー単体 (15+ ケース: 全演算子 + 複合 + 不正)
  - エンドポイント (10+ ケース): 200 / 400 (不正 since) / cursor 連続性 / ブロック除外 / has:image / has:code
  - 並び替え `sort=created_at` で時系列、`sort=relevance` で関連度

### 受け入れ基準

- [ ] `kubernetes tag:k8s from:@taro since:2026-01-01` で 4 条件の AND 検索が動く
- [ ] `tag:python tag:django` で 2 タグ AND 検索
- [ ] `has:code` でコードブロック含むツイートのみ
- [ ] 不正な `since:abc` で 400 + clear error
- [ ] ブロック相手のツイートが結果に出ない
- [ ] cursor pagination が 60 件を 3 ページで網羅

---

## P2-13. [feature][frontend] ホーム TL UI (アルゴリズム / フォロー中タブ) — 🚧 再投入中

- **Labels**: `type:feature`, `layer:frontend`, `area:timeline`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: L (1-2d)
- **Parallel**: P2-14, P2-15, P2-16, P2-17, P2-18 と並列可
- **Depends on**: P2-08
- **Status**: 元実装 (commit `129880b`) は **DOMPurify 抜け + 要件大幅未達** で Revert (`8694d88`)。本セッションで TDD 再投入中 (PR `feature/issue-186-home-tl-ui`)。
- **本 PR スコープ**: TimelineTabs / TweetCard (DOMPurify 必須) / HomeFeed (limit-based「もっと見る」) / `/` auth 分岐
- **本 PR スコープ外 (フォローアップ Issue 起票済)**:
  - リアクション / RT / 引用 RT / リプライの onClick logic → P2-14 / P2-15
  - 「もっと見る」本文展開 → P2-18
  - サイドバー → P2-17
  - 未ログイン `/explore` リダイレクト → P2-19
  - cursor 無限スクロール → #200 (backend 拡張)
  - 既存 3 ページの DOMPurify 抜け修正 → #198
  - axios CVE → #199
  - `role="feed"` 完全準拠 → #201

### 目的

SPEC §5.1 / §5.2 のホーム TL を実装。「アルゴリズム (おすすめ)」「フォロー中」の 2 タブ、cursor 無限スクロール、オプティミスティック RT / リアクション、`@<handle>` メンション内リンク、`#` の代わりに UI で別途付与されたタグ chip。

### 作業内容

- [ ] `client/src/app/(authed)/page.tsx` (root の `/` を Phase 1 の placeholder から TL に置換)
- [ ] **タブコンポーネント** (`<TimelineTabs>`): shadcn `Tabs` で「おすすめ」「フォロー中」を切替
  - URL state: `?tab=recommended|following` で永続化 (Web rules: URL As State)
  - 切替時に各 tab 用 `tl:home:` / `tl:following:` を別 SWR key で fetch
- [ ] **TweetCard コンポーネント** (`<TweetCard>`):
  - author avatar / display_name / @handle / created_at (relative)
  - body (P1-09 のレンダリング HTML を表示、**sec CRITICAL #2: クライアント側で `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })` を必ず通してから `dangerouslySetInnerHTML`** に渡す。サーバー側 sanitize は最初の防御層、クライアント側 sanitize は二重防御として **必須**。「サーバー sanitize 済み前提」で素通しすることは禁止)
  - tag chips (clickable → `/tag/<name>`)
  - images (1〜4 枚 grid)
  - OGP card (P2-07 の data があれば)
  - リアクションバー (P2-14 サブコンポーネント呼び出し)
  - reply / repost / quote ボタン (P2-15 サブコンポーネント呼び出し)
  - 削除済み reply_to / quote_of は tombstone 表示
- [ ] **Repost 表示**: `type=repost` の場合、上部に「○○がリポストしました」(SPEC §3.3, X 準拠)、本体は `repost_of` のカード
- [ ] **Quote 表示**: `type=quote` の場合、自分のコメント上、`quote_of` を inline 埋め込みカード
- [ ] **無限スクロール**: TanStack Query `useInfiniteQuery` で cursor pagination
  - IntersectionObserver で末尾近接 → 自動次ページ
  - 「新しいツイート N 件」: 上端到達時に poll で head check (1 分ごと, query 軽量化のため `if-modified-since` 風 ETag)
- [ ] **オプティミスティック更新**:
  - 自分の Composer (P1-16) で投稿 → TL 上端に即時 prepend、後で server data で reconcile
  - リアクション / RT は P2-14 / P2-15 内
- [ ] **モバイル対応**: 320px 幅で崩れない、ボトムナビ + 上部固定 タブ
- [ ] **未ログイン時**: `/` にアクセスすると `/explore` へリダイレクト (P2-19)

### 受け入れ基準

- [ ] 「おすすめ」タブで 70:30 アルゴリズムの結果が見える
- [ ] 「フォロー中」タブで時系列のみが見える
- [ ] 無限スクロールで自動次ページ (cursor 連続)
- [ ] Composer 投稿が 200ms 以内に上端に表示される
- [ ] Lighthouse perf > 80 / a11y > 95 (TL 単独ページ)

---

## P2-14. [feature][frontend] リアクション UI (10 種 + Alt+Enter キーボード代替)

- **Labels**: `type:feature`, `layer:frontend`, `area:reactions`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-13, P2-15, P2-16, P2-17, P2-18 と並列可
- **Depends on**: P2-04

### 目的

SPEC §6 の 10 種絵文字リアクション UI。1 ツイートに 1 種類のみ、再押下で取消、別種に変更で前のリアクションを自動取消する X 式インタラクション。アクセシビリティとして **Alt+Enter キーボード代替** で picker を開けるようにする。

### 作業内容

- [ ] `client/src/components/reactions/ReactionBar.tsx`:
  - 一番直近に押した kind を primary ボタンとして表示 (X 同様、デフォルト `like`)
  - 長押し / hover でピッカー展開、10 種を grid で表示
  - クリックで toggle (post → 201 / 200 / 204 を P2-04 のレスポンスで判定)
  - 表示: `<emoji> <count>` (集計は Tweet serializer の `reactions: {kind: count}`)
  - 自分の現在の kind はハイライト
- [ ] **キーボード対応**:
  - primary ボタンに focus 時 `Enter` → toggle primary
  - `Alt+Enter` (Mac: `Option+Enter`) → ピッカーを開く (focus trap, Esc で閉じる)
  - ピッカー内は ←→↑↓ で kind 移動、Enter で確定
  - aria-haspopup, aria-expanded, role="menu", role="menuitem" を適切に
- [ ] **オプティミスティック更新**:
  - 押下と同時に count を即時更新、エラー時に rollback (TanStack Query `useMutation` の `onMutate / onError`)
- [ ] **アニメーション**:
  - 押下時に絵文字が pop (scale 0.8 → 1.2 → 1.0、150ms, ease-out)
  - `prefers-reduced-motion: reduce` を尊重して animation skip
- [ ] **モバイル対応**:
  - tap で primary toggle、long-press (300ms+) でピッカー
  - touch device 判定で hover を発火させない
- [ ] **i18n**: ラベルは SPEC §6.2 の日本語 (`いいね`, `面白い` など)
- [ ] vitest + playwright a11y: keyboard で全 10 種に到達可能、screen reader でラベルが読まれる

### 受け入れ基準

- [ ] マウスで primary ボタン押下 → reaction が toggle (オプティミスティック)
- [ ] hover で 10 種ピッカー展開
- [ ] キーボードのみで 10 種すべて選択可能 (Alt+Enter で picker 起動)
- [ ] 別 kind を選ぶと前の kind が消えて count 整合
- [ ] reduced-motion 環境で animation スキップ
- [ ] Lighthouse a11y 100 (リアクションバー単体)

---

## P2-15. [feature][frontend] RT / 引用 RT / リプライ UI

- **Labels**: `type:feature`, `layer:frontend`, `area:tweets`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-13, P2-14, P2-16, P2-17, P2-18 と並列可
- **Depends on**: P2-06, P2-07 (OGP 表示), P1-16 (Composer 再利用)

### 目的

SPEC §3.3 / §3.4 の RT / 引用 RT / リプライの UI。ツイートカードの下部にアイコンボタン群、押下時の挙動を分岐させ、Composer (P1-16) を Modal で再利用して引用 RT / リプライを書かせる。

### 作業内容

- [ ] `<TweetActions>` コンポーネント (TweetCard 子):
  - 4 つのアイコンボタン: 返信 (MessageCircle) / RT (Repeat2) / 引用 (Quote) / 共有 (Share2)
  - RT は別途 Repeat2 ボタンに dropdown「リポスト / 引用」(X 準拠)
- [ ] **RT (Repost)**:
  - クリック → `POST /tweets/<id>/repost/` 発火、オプティミスティックでアイコンが緑に
  - 既に RT 中 → `DELETE /tweets/<id>/repost/` で取消、アイコンが灰色に
  - count を即時更新
- [ ] **引用 (Quote)**:
  - クリック → Composer Modal を開き、上部に元ツイートの inline preview を表示
  - body 入力 (180 字 / Premium 500 字、P1-10 ロジック共有), tags 最大 3, images 最大 4
  - submit → `POST /tweets/<id>/quote/` 発火、成功で modal 閉じ、TL 上端に optimistic prepend
- [ ] **Reply**:
  - クリック → Composer Modal、上部に `replying to @handle` バナー + 元ツイート inline
  - submit → `POST /tweets/<id>/reply/` 発火
- [ ] **OGP 連携**: 引用 / Reply の本文に URL 含む場合、Composer のプレビュー領域に簡易 OGP プレビュー (実取得は Phase 1 P1-16 既存ロジック流用)
- [ ] **モバイル対応**: Modal はフルスクリーン化 (320px 〜)、戻るボタンで close
- [ ] **a11y**: aria-label `返信` / `リポスト` / `引用` / `共有`、focus trap

### 受け入れ基準

- [ ] RT ボタンで即時 RT → 再押下で取消
- [ ] 引用 Modal で Composer の文字数カウントが正しく動作
- [ ] Reply Modal で元ツイート preview が正しく表示
- [ ] 削除済みツイートに対して RT / Reply / Quote ボタンを無効化
- [ ] Modal 閉じ後 TL の該当ツイートの reply_count / repost_count / quote_count が +1

---

## P2-16. [feature][frontend] 検索画面 UI (`/search`、フィルタ演算子サジェスト)

- **Labels**: `type:feature`, `layer:frontend`, `area:search`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-13, P2-14, P2-15, P2-17, P2-18 と並列可
- **Depends on**: P2-12

### 目的

SPEC §10 の検索画面を実装。検索バー + 演算子サジェスト + 結果タブ (すべて / ツイート / 記事 (Phase 6 で実装後活性)) + 並び替え (新着 / 関連度) + 未ログイン閲覧可。

### 作業内容

- [ ] `client/src/app/search/page.tsx` (Server Component で初期 query を URL から fetch)
- [ ] **検索バー** (`<SearchBox>`):
  - 入力中に sub-token を検出して suggestion dropdown を表示
  - `tag:` 入力中 → `/api/v1/tags/?q=` で incremental search
  - `from:@` 入力中 → `/api/v1/users/?q=` で handle 候補
  - `since:` / `until:` 入力中 → 日付ピッカー (calendar)
  - `type:` / `has:` 入力中 → 固定値リスト (tweet/article, image/code)
  - 既存トークンを chip 化 (Backspace で削除)
- [ ] **タブ**: shadcn Tabs で「すべて」「ツイート」「記事」(記事は Phase 6 で活性、ここでは disabled or "近日公開")
- [ ] **並び**: 「新着順」「関連度順」(URL: `?sort=created_at|relevance`)
- [ ] **結果リスト**: TweetCard を再利用、無限スクロール (TanStack Query useInfiniteQuery + cursor)
- [ ] **空状態**: 「該当ツイートがありません」+ 演算子のヘルプリンク
- [ ] **エラー状態**: 不正 since/until → 400 メッセージを inline 表示
- [ ] **URL state**: `?q=...&tab=...&sort=...` で全 state を URL に永続化 (shareable)
- [ ] **未ログイン**: 401 が返らないことを確認 (P2-12 が auth optional)
- [ ] **メタ**: `<title>「kubernetes」の検索結果 — SNS</title>`
- [ ] **a11y**: search role, aria-live で結果数アナウンス

### 受け入れ基準

- [ ] `kubernetes tag:k8s from:@taro since:2026-01-01` の URL 直接アクセスで結果表示
- [ ] サジェストで `tag:py` を入力 → `python` / `pytest` / `pytorch` が表示
- [ ] 関連度順 / 新着順タブ切替で結果並びが変わる
- [ ] URL に query を埋めた状態でブックマーク → 同じ結果を再現
- [ ] Lighthouse SEO 95+ (検索結果ページ)
- [ ] 未ログインで `/search?q=python` が 200

---

## P2-17. [feature][frontend] トレンドタグ / おすすめユーザーサイドバー

- **Labels**: `type:feature`, `layer:frontend`, `area:timeline`, `area:tags`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-13, P2-14, P2-15, P2-16, P2-18 と並列可
- **Depends on**: P2-09, P2-10

### 目的

SPEC §16.3 の右サイドバー。PC 幅で常時表示、トレンドタグ Top 10 とおすすめユーザー Top 5 を縦並び。タブレット幅では非表示、モバイルではコンテンツ末尾に折りたたみ表示。

### 作業内容

- [ ] `client/src/components/sidebar/RightSidebar.tsx`:
  - 768〜1024px: 隠す、1024px+: 表示
  - サブコンポーネント: `<TrendingTags>`, `<WhoToFollow>`
- [ ] `<TrendingTags>`:
  - `GET /api/v1/tags/trending/` を SWR で 5 分ポーリング
  - 上位 10 件を rank + 絵文字 + tag name + uses で表示
  - クリックで `/tag/<name>`
  - skeleton loading
- [ ] `<WhoToFollow>`:
  - `GET /api/v1/users/recommended/?limit=5` (auth) or `/users/popular/?limit=5` (unauth) を auth 状態で switch
  - avatar + display_name + reason chip + フォローボタン
  - フォローボタン押下で楽観更新、エラーで rollback
- [ ] **編集デザイン**: 安易な template 感を避ける (web/design-quality.md):
  - card にうっすら border + 内側 padding
  - rank 番号は accent カラーで太字
  - hover で行が subtle に highlight
- [ ] **モバイル**: TL 末尾に「もっと見る」ボタンで折りたたみ展開
- [ ] **空状態**: トレンド 0 件で「トレンドはまだ集計中です」
- [ ] **未ログイン**: WhoToFollow は `/users/popular/` のみ、reason chip は表示しない

### 受け入れ基準

- [ ] PC で右サイドバーが見える、タブレットで消える、モバイルで末尾展開
- [ ] トレンドタグが 30 分以内のキャッシュ範囲で更新
- [ ] WhoToFollow のフォローボタンが TL 上のフォローボタンと state 同期 (TanStack Query cache invalidation)
- [ ] スケルトンが表示されたあとに実 data に切り替わる

---

## P2-18. [feature][frontend] 「もっと見る」展開 (X 準拠、長文・コードブロック・画像)

- **Labels**: `type:feature`, `layer:frontend`, `area:tweets`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-13〜P2-17 と並列可
- **Depends on**: P2-13 (TweetCard が存在)

### 目的

SPEC §3.6 の「もっと見る」展開。X 準拠で、画像・動画・コードブロック含む or 高さ閾値超えの本文を折りたたみ、ボタンで全文展開する。テキストのみ 180 字までは常時全文表示 (短文は短いまま min-height を確保しない)。

### 作業内容

- [ ] `<ExpandableContent>` コンポーネント:
  - 子要素を `max-height: 28rem`(目安) でクリップし、`overflow: hidden`
  - `useEffect` で `scrollHeight > clientHeight` を判定 → ボタン表示
  - ボタン押下で `max-height` を `none` に変更、CSS transition でスムーズに展開
- [ ] **適用条件**:
  - 画像 1 枚以上
  - コードブロック ` ``` ` を本文に含む (server から `has_code` flag、無ければ client 検出)
  - レンダリング後の高さが 28rem 超過
  - 上記いずれか一つでも該当
- [ ] **アニメーション**: `prefers-reduced-motion: reduce` 尊重
- [ ] **a11y**: ボタンに `aria-expanded`, ラベル「もっと見る / 折りたたむ」
- [ ] **TL とツイート詳細で共通利用**:
  - TL では折りたたみ ON
  - ツイート詳細 (P1-17) では折りたたみ OFF (常時全文)
- [ ] vitest: 高さ閾値判定 / aria 属性 / 展開後 state

### 受け入れ基準

- [ ] 短文 (180 字以下、画像なし、コードなし) は折りたたみされない (min-height 確保なし)
- [ ] コードブロックを含むツイートは折りたたみ表示
- [ ] 画像付きツイートは折りたたみ表示
- [ ] 「もっと見る」クリックで全文展開、ボタンが「折りたたむ」に変化
- [ ] reduced-motion で animation スキップ

---

## P2-19. [feature][frontend] 未ログイン用 `/explore` ページ

- **Labels**: `type:feature`, `layer:frontend`, `area:timeline`, `area:seo`, `priority:medium`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: P2-13〜P2-18 と並列可
- **Depends on**: P2-08 (`/timeline/explore/`), P2-09 (trending), P2-10 (popular)

### 目的

SPEC §16.2 の `/explore` を実装。未ログインユーザー向けに「全体トレンドツイート + トレンドタグ + 人気ユーザー」を見せる発見/集客ページ。SEO 対象。

### 作業内容

- [ ] `client/src/app/explore/page.tsx` (Server Component で初期データ fetch)
- [ ] レイアウト:
  - 上段: ヒーローバナー + 「ログインして体験する」CTA
  - メイン: トレンドツイート 20 件 (`GET /timeline/explore/`)
  - サイド: トレンドタグ + 人気ユーザー (P2-17 の `<RightSidebar>` 流用)
- [ ] **CTA**: ツイートカードのアクションボタン (返信 / RT / リアクション) は disabled + tooltip「ログインしてください」
- [ ] **OGP**: og:title, og:description, og:image (静的 placeholder)
- [ ] **JSON-LD**: `WebSite` schema + `SearchAction` (検索機能を構造化)
- [ ] **メタ**: `<title>エンジニア SNS — エンジニアによる、エンジニアのための SNS</title>`
- [ ] **未ログイン → ログイン誘導** (arch H-4: **CLS 0 保証**): ページ滞在 30s で sticky bottom banner「ログインしてもっと見る」を **`position: fixed`** で配置（layout shift を起こさない）、初回 paint 時には DOM から除外し IntersectionObserver で 30s タイマー後に挿入、LocalStorage で dismiss 可
- [ ] **ログイン済の場合**: `/explore` にアクセスしたら `/` (TL) へリダイレクト (UX を分離)
- [ ] **デザイン品質** (web/design-quality.md): default テンプレ感を避ける、ヒーローはコピー + コードスニペット視覚要素 + 鮮やかな accent

### 受け入れ基準

- [ ] 未ログインで `/explore` 200 + 全体トレンドツイートが表示
- [ ] アクションボタン (RT / Reply 等) は disabled + tooltip
- [ ] ログイン済で `/explore` にアクセス → `/` にリダイレクト
- [ ] Lighthouse SEO 95+, perf 80+
- [ ] OGP / JSON-LD が validator で OK

---

## P2-20. [chore][backend] pytest カバレッジ 80% gate (Phase 2 範囲)

- **Labels**: `type:chore`, `layer:backend`, `area:ci`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: S (< 4h)
- **Parallel**: 他 Issue と並列可だが Phase 2 末で merge 必須
- **Depends on**: P2-03 〜 P2-12 (テスト対象実装が揃ってから)

### 目的

Phase 1 P1-21 で配線済の pytest + coverage 80% gate を、Phase 2 で追加された apps (`apps/follows`, `apps/reactions`, `apps/timeline`, `apps/search` + apps/tweets 拡張) に拡張。`coverage report --fail-under=80` を CI で fail させる。

### 作業内容

- [ ] `pyproject.toml` の `[tool.pytest.ini_options]`:
  - `--cov=apps.follows --cov=apps.reactions --cov=apps.timeline --cov=apps.search` を追加
  - `testpaths` に新規 apps を追加
- [ ] **factory_boy fixtures** を追加:
  - `FollowFactory`, `ReactionFactory`, `TweetFactory(with_replies=True)`, `OgpCacheFactory`
- [ ] **共通 fixtures** (`conftest.py`):
  - `redis_clean` fixture (各テスト前に `flushall` で隔離、`fakeredis` 推奨)
  - `eager_celery` fixture (`CELERY_TASK_ALWAYS_EAGER=True`)
  - `mock_meilisearch` fixture (採用時のみ、`responses` でモック)
- [ ] **CI 拡張** (`.github/workflows/ci.yml`):
  - matrix に `services: meilisearch` (採用時) を追加 or skip
  - `coverage report --fail-under=80` を pass しない場合は fail
- [ ] **slow test marker**: TL 70:30 検証は仕込みデータ多くて 2s 以上 → `@pytest.mark.slow` で別 job に分離 (PR では skip, main で実行)
- [ ] ドキュメント `docs/operations/testing.md` を Phase 2 用 fixtures 追記

### 受け入れ基準

- [ ] `pytest` で `apps.follows` / `apps.reactions` / `apps.timeline` / `apps.search` のカバレッジが 80%+
- [ ] CI で 80% 未満なら fail する
- [ ] `pytest -m "not slow"` が PR 対象で 60s 以内で完走
- [ ] `pytest` 全体が main で 5 分以内で完走

---

## P2-21. [test][frontend] E2E シナリオ (Playwright): フォロー → リアクション → TL 反映 → 検索

- **Labels**: `type:test`, `layer:frontend`, `area:e2e`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: P2-13〜P2-19 完了後の直列位置
- **Depends on**: P2-13, P2-14, P2-15, P2-16, P2-19

### 目的

Phase 2 完了の受入テストを Playwright で 1〜2 本実装。「ユーザー A がユーザー B をフォロー → B が投稿 → A の TL に反映 → A がリアクション → A が検索でツイートを発見」の golden path を CI で守る。

### 作業内容

- [ ] `client/e2e/phase2.spec.ts` を新規追加
- [ ] **シナリオ 1: フォロー / リアクション / TL 反映**:
  1. ユーザー A / B でログイン (Phase 1 e2e helper 流用)
  2. A が `/u/<B-handle>` でフォロー
  3. B でログインし `/` の Composer から「Phase2 e2e test #unique-uuid」を投稿 (タグ `python`)
  4. A で再ログイン → `/?tab=following` で B のツイートが上端に
  5. A がリアクション `like` を押す → count 0 → 1
  6. A が「いいね」を再押下 → count 1 → 0
  7. A が `learned` に変更 → count 1 (種別変更)
  8. B でログイン → 通知 (Phase 4 でフル実装、ここではログ確認のみ)
- [ ] **シナリオ 2: 引用 RT + 検索**:
  1. A が B の上記ツイートを Quote「面白い tag:python」で投稿
  2. A が `/search?q=面白い tag:python` で検索 → 引用ツイートが結果に出る
  3. `from:@<A-handle>` を追加 → A の Quote のみに絞り込まれる
- [ ] **シナリオ 3: 未ログイン /explore**:
  1. ログアウト
  2. `/explore` を開く
  3. トレンドツイートが見える
  4. 「いいね」ボタンが disabled
- [ ] **mailpit / Redis / Meilisearch** が docker-compose で立ち上がっている前提
- [ ] **CI**: `e2e` ラベル付き PR or main push で実行 (Phase 1 から踏襲)
- [ ] **失敗時 artifact**: screenshot + trace を保存

### 受け入れ基準

- [ ] ローカルで `npx playwright test phase2` が完走
- [ ] CI で同シナリオが 8 分以内で pass
- [ ] フォロー → ツイート → TL 反映の time-to-visible が < 3s
- [ ] 失敗時に artifact が upload される
- [ ] Phase 1 シナリオ (`phase1.spec.ts`) も並走 pass (regression なし)

---

## P2-22. [deploy][infra] Phase 2 stg デプロイ + 動作確認

- **Labels**: `type:deploy`, `layer:infra`, `priority:high`
- **Milestone**: `Phase 2: TL・リアクション・フォロー・検索`
- **Estimate**: M (4-8h)
- **Parallel**: 最終工程、直列
- **Depends on**: P2-01 〜 P2-21 全完了

### 目的

Phase 1 P1-23 で立ち上げた stg 環境に Phase 2 実装をデプロイ、AWS 環境で golden path が動くことを手動で確認。Phase 2 完了ゲート。

### 作業内容

- [ ] **インフラ更新**:
  - 採用バックエンドが Meilisearch なら `terraform/modules/compute` に Meilisearch ECS service を追加 (cpu 0.5/mem 1GB)
  - SG: `meilisearch-sg` で 7700/tcp from `ecs-sg`
  - EBS gp3 20GB volume を attach、初回起動時に index 再構築 task
  - ALB / CloudFront 経由で Meilisearch 直公開はせず、Django から VPC 内通信のみ
- [ ] **`.envs/.env.stg`**:
  - `SEARCH_BACKEND=pg_bigm` or `meilisearch`
  - `MEILISEARCH_HOST` / `MEILISEARCH_API_KEY` (Secrets Manager)
- [ ] **migrate**: Phase 2 で追加された migration (Follow, Reaction, OgpCache, signals 等) を `ecs run-task` で適用
- [ ] **stg `stg.<domain>` で手動確認**:
  - フォロー / アンフォロー → followers_count 連動
  - リアクション 10 種すべて押下 → 集計 / 取消 / 種別変更
  - RT / 引用 RT / リプライ → カウンタ / 通知
  - OGP カード生成 (URL を含むツイートで実 URL の OGP 取得確認)
  - TL アルゴリズム / フォロー中タブ
  - トレンドタグサイドバー、おすすめユーザーサイドバー
  - 検索 (kubernetes / tag:python / from:@xxx / since:... の各演算子)
  - `/explore` 未ログインで動作
- [ ] **CloudWatch メトリクス確認**:
  - `timeline.cache_hit_rate` が 1h 観測で 85% 以上 (P2-08 受入基準)
  - `timeline.build_latency_p95` < 500ms
  - RDS CPU < 60% (burst credit 残量問題なし)
- [ ] **Sentry**: stg プロジェクトでエラー 0 を 1h 観測
- [ ] **コスト確認**: Phase 2 後の stg 月額が ¥25-35k 範囲に収まる (Meilisearch 採用なら +¥3,000/月)
- [ ] **ALB**: target group の Healthy count が常に > 0
- [ ] **Celery Beat**: trending tags / who-to-follow の定期 task が CloudWatch logs で見える

### 受け入れ基準

- [ ] stg で E2E シナリオ (P2-21) が手動で完走
- [ ] cache_hit_rate > 85% (1h 観測)
- [ ] Sentry / CloudWatch にエラーログなし
- [ ] ALB health check 緑
- [ ] コスト monitor グラフが target 範囲 (¥25-35k/月) 内
- [ ] ROADMAP の Phase 2 受け入れ基準 4 項目すべて達成
