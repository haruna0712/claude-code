# 実装ロードマップ（Phase 分割）

> Version: 0.4
> 最終更新: 2026-05-01
> 関連: [SPEC.md](./SPEC.md), [ER.md](./ER.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [A11Y.md](./A11Y.md), [REVIEW_CONSOLIDATED.md](./REVIEW_CONSOLIDATED.md)
>
> v0.3 → v0.4 変更点:
>
> - **Phase 1 / 2 完了**: Phase 1 (23 Issue + F1-1〜F1-7 セキュリティ修正)、Phase 2 (22 Issue + #198/#199/#200/#201 follow-up) ともに stg 動作確認まで完走
> - **Phase 3 起票**: 22 Issue (#226〜#247) を `Phase 3: DM` マイルストーンに起票完了
> - **人日見積を撤去**: 実装は AI (Claude Code) が行うため、人間エンジニア前提の「目安工数」「累計」は参考にならない。タイムライン表からこの 2 列を削除し、合計見積ブロックも除去。Issue 単位の相対サイズ (XS/S/M/L) は PR 粒度の目安として残す
>
> v0.2 → v0.3 変更点:
>
> - **Phase 0 完了**: 13 Issue すべてマージ済み (P0-01〜P0-13)
> - **Phase 0.5 コード完了**: 15/16 Issue マージ済み、残 1 は ハルナさん手動実行 (P0.5-15 stg 初回デプロイ)
> - Phase 0.5 のレビュー指摘で発生した 15 件のフォローアップを [phase-0.5-followups.md](./issues/phase-0.5-followups.md) に集約
>
> v0.1 → v0.2 主要変更（planner レビュー反映）:
>
> - **Phase 0.5 新設**: 最小 stg デプロイ (C-3)
> - Phase 0 に観測性セットアップ追加 (M-4)
> - Phase 1 にタグ編集距離チェック追加 (H-7)
> - Phase 3 に S3 プリサインド URL 必須化 (H-6)
> - Phase 4 を 4A / 4B に分割 (H-4)
> - Phase 6 GitHub 連携を片方向に縮退 (Q1, M-5)
> - Phase 9 を「本番昇格」に変更（stg は各 Phase 末で逐次デプロイ）
> - Phase 10 は Claude Design 取り込み維持（Q3: 全体が出揃ってから実施）
> - 工数見積を **4.5 ヶ月（115〜135 日）** に修正 (Q4)

---

## 0. 前提と進め方

### 0.1 方針

- **Issue-First**: 各 Phase 着手前に GitHub Issues を細かく具体的に発行（1 Issue = 1 PR の粒度）
- **git worktree 並列化**: 独立性の高い Issue は別々の worktree で並行実装
- **Phase ごとにデモ可能な成果物**を定義し、各 Phase 完了後に動作確認
- **TDD（Red → Green → Refactor）を徹底**、各 Phase で 80% 以上のテストカバレッジ
- サブエージェント（code-reviewer, security-reviewer, database-reviewer, a11y-architect, python-reviewer, typescript-reviewer）を **PR ごとに並列起動**
- Terraform は **Phase 0.5 で骨子** → 各 Phase で必要な分を追加、Phase 末に stg デプロイ
- Claude Design は **Phase 10 で一括取り込み**（全体感をユーザー自身が見て判断）

### 0.2 全体タイムライン

> v0.4 で「目安工数」「累計」列を削除した経緯は冒頭の変更履歴を参照。Issue 単位のサイズ感は `docs/issues/phase-N.md` 各 Issue の `Estimate` フィールドを参照。

| Phase     | 内容                                                            | 状態                                                                                       |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Phase 0   | セットアップ・基盤整備・観測性                                  | ✅ **完了** (13/13 Issue)                                                                  |
| Phase 0.5 | 最小 stg デプロイ（Hello World 相当）                           | ✅ **完了** (16/16、stg apply + NS 委任 + ACM + HTTPS まで本番稼働)                        |
| Phase 1   | 認証・プロフィール・基本ツイート (+ F-02/F-10/F-11/F-14 前倒し) | ✅ **完了** (23/23 Issue + F1-1〜F1-7 セキュリティ修正)                                    |
| Phase 2   | TL・リアクション・フォロー・検索 (+ F-15 pg_bigm migration)     | ✅ **完了** (22 Issue + follow-up #198/#199/#200/#201、stg E2E API golden path 全 pass)    |
| Phase 3   | DM（リアルタイム、S3 プリサインド含む）                         | 着手中 (22 Issue #226〜#247 起票済)                                                        |
| Phase 4A  | 通知・お気に入りボックス                                        | 計画                                                                                       |
| Phase 4B  | モデレーション（Block/Mute/Report）                             | ✅ **コード完了** (10 Issue: #443-#452 / PR #453、stg デプロイ + 動作確認待ち)             |
| Phase 5   | 掲示板                                                          | ✅ **コード完了** (12 Issue: #425-#434, #436, #437 / PR #438、stg デプロイ + 動作確認待ち) |
| Phase 6   | 記事機能（GitHub 片方向 push のみ）                             | 計画                                                                                       |
| Phase 7   | Bot（RSS + AI 要約、+ F-04 Redis 分離）                         | 計画                                                                                       |
| Phase 8   | プレミアム機能（Stripe + 記事 AI、+ F-01 webhook WAF）          | 計画                                                                                       |
| Phase 9   | 本番昇格・負荷試験・Lighthouse CI (+ F-03/05/06/07/08/09/12/13) | 計画                                                                                       |
| Phase 10  | Claude Design 取り込み・a11y 監査・SEO                          | 計画                                                                                       |

### 0.3 Phase 0 / 0.5 実績サマリ

**Phase 0** (完了、2026-04-21〜22): 10 ラウンドの並列 PR で 13 Issue をマージ。
サブエージェントレビュー (python-reviewer / typescript-reviewer / security-reviewer /
a11y-architect / architect / doc-updater) を毎 PR で起動、指摘を反映する循環を確立。

**Phase 0.5** (完了、2026-04-22〜30): 7 モジュール構成の Terraform + 結合 env +
Django health endpoint + Next.js Hello + GitHub Actions OIDC + cd-stg.yml + 運用手順書。
2026-04-30 のセッションで stg 初回 apply + NS 委任 + ACM 発行 + ALB HTTPS:443 listener

- CloudFront + WAF まで完走 (commit `b89d697` / `f9b90f0` / `2dbcb12` / `cec883f`)。
  レビュー指摘の 15 件は `docs/issues/phase-0.5-followups.md` に集約し Phase 1 / 7 / 8 /
  9 のマイルストーンに紐付け済み。

**Phase 1** (完了、2026-04-25〜30): バックエンド (auth + tweet CRUD + profile + tag) と
フロントエンド (login / register / onboarding / profile / tweet detail / tag) の 8 画面
を実装、F1-1〜F1-7 のセキュリティ修正、stg デプロイ + 動作確認まで完走。`https://stg.codeplace.me/`
で実際にランディング → 新規登録 → アクティベ (CloudWatch ログから URL 取得) → ログイン
までエンドツーエンド可能。

**Phase 2** (完了、2026-05-01): TL アルゴリズム配信 (フォロー 70% + 全体 30%)、
リアクション 10 種、フォロー / フォロワー、リポスト / 引用 / リプライ、検索 (pg_bigm
仮採用、フィルタ演算子 `tag:` `from:` `since:` `until:` `type:` `has:`)、ホーム TL UI
(タブ / 楽観的 prepend / もっと見る展開)、サイドバー (TrendingTags + WhoToFollow)、
`/explore` 公開ページ、`/search` ページ。Follow-up: `#198` 既存ページ DOMPurify、`#199`
axios CVE、`#200` cursor pagination、`#201` `role="feed"` a11y 完全準拠。`stg.codeplace.me`
上で **API E2E** (test2/test3 アカウント) を curl で実行、ログイン → ツイート投稿 →
フォロー → リアクション → TL `following` 反映 → 検索 (キーワード / `from:` 演算子) →
リポスト / 引用 / リプライ → クリーンアップ まで全 9 + 4 ステップ pass。frontend UI 動作
確認は P2-21 の Playwright spec を別途実行する想定。

---

## Phase 0: セットアップ・基盤整備・観測性

### 目的

既存スケルトンの整備、追加ライブラリ導入、観測性配線、デザイントークンのプレースホルダ化。

### タスク（Issue になる単位）

- [x] **追加 Python パッケージ導入**（`requirements/base.txt`）
  - `channels`, `channels-redis`, `daphne`
  - `social-auth-app-django`（Google OAuth）
  - `stripe`
  - `boto3`, `django-storages`
  - `bleach`, `markdown2`, `Pygments`
  - `Pillow`
  - `python-slugify`
  - `feedparser`
  - `openai`, `anthropic`
  - `PyGithub`
  - `sentry-sdk[django]`
  - `structlog`
  - `django-ratelimit`
  - `django-bigm` or 相当ライブラリ（pg_bigm 連携用、Phase 2 で使用）
- [x] **追加 npm パッケージ導入**（`client/package.json`）
  - `react-easy-crop`
  - `react-markdown`, `remark-gfm`, `rehype-highlight`, `shiki`
  - `@stripe/stripe-js`
  - `reconnecting-websocket`
  - `@sentry/nextjs`
- [x] **`local.yml` に daphne サービス追加**（WebSocket ASGI サーバー）
- [x] **apps/ 配下に 13 新アプリを scaffold**:
      `apps/tweets`, `apps/tags`, `apps/follows`, `apps/reactions`, `apps/boxes`,
      `apps/notifications`, `apps/dm`, `apps/boards`, `apps/articles`,
      `apps/moderation`, `apps/bots`, `apps/billing`, `apps/search`
- [x] **Sentry SDK 配線**（`config/settings/base.py` + DSN 環境変数）
- [x] **`structlog` で構造化ログ設定**（Django / Celery）
- [x] **`@sentry/nextjs` 初期化**（client/sentry.\*.config.ts）
- [x] **`docs/adr/` ディレクトリ + ADR-0001 テンプレート作成**
- [x] **基本デザイントークン CSS 変数**（`client/src/styles/tokens.css` プレースホルダ）
  - 後で Claude Design bundle で置換可能な構造にしておく
- [x] **shadcn/ui のコアコンポーネント配置確認**（Button / Input / Card / Avatar / Dialog / Badge / Tabs）
- [x] **`.github/workflows/ci.yml` 雛形**（PR 時 lint + test）
- [x] **`pre-commit` 設定**（ruff, black, prettier, eslint）
- [x] **README.md に開発環境立ち上げ手順追記**

### 並列化候補（git worktree）

- Python 依存追加 / npm 依存追加 / apps scaffold は独立 → 3 worktree 並行可能
- Sentry 設定 / structlog 設定は上記完了後に直列
- デザイントークン / shadcn 配置 / ADR 作成 は独立

### 受け入れ基準

- [x] `docker compose -f local.yml up` で全サービス起動
- [x] `pytest` / `npm test` がグリーン
- [x] Sentry に意図的なエラーを投げてダッシュボードで受信確認
- [x] PR 作成時に CI が走る

---

## Phase 0.5: 最小 stg デプロイ（新設）

### 目的

Hello World レベルで AWS stg 環境を先行構築し、以降の各 Phase 末に逐次デプロイできる基盤を作る。**これを Phase 9 まで先送りしない**（architect + planner レビュー C-3）。

### タスク

#### Terraform

- [x] **tf-state 用 S3 + DynamoDB lock テーブル作成**（bootstrap スクリプト）
- [x] **`terraform/modules/network` 実装**:
  - VPC, subnets (public/private/db × 2 AZ), IGW, Route Tables, SGs
  - fck-nat ASG（t4g.nano）
  - VPC Interface Endpoints（ECR API/DKR, Secrets, Logs, STS）, Gateway Endpoint (S3)
- [x] **`terraform/modules/data` 実装**:
  - RDS PostgreSQL（Single-AZ, t4g.micro, 20GB, pg_bigm + pg_trgm 有効化）
  - ElastiCache Redis（Single-node, cache.t4g.micro）
- [x] **`terraform/modules/compute` 実装**:
  - ECS Cluster（FARGATE + FARGATE_SPOT）
  - ALB（sticky session, idle_timeout=3600, listener rules）
  - ECR repositories（`sns-backend`, `sns-frontend`, `sns-nginx`）
- [x] **`terraform/modules/edge` 実装**:
  - CloudFront（単一ディストリ、パスベース分岐）
  - Route53 Hosted Zone
  - ACM 証明書（us-east-1 + ap-northeast-1）
- [x] **`terraform/modules/observability` 実装**:
  - CloudWatch Log Groups（`/ecs/sns-stg/*`）
  - CloudWatch Alarms（ECS CPU, RDS CPU, ALB 5xx 率）
  - SNS Topic（アラート配信用、管理者メール）
- [x] **`terraform/environments/stg/main.tf` 結合**
- [x] **S3 バケット: `sns-stg-media`, `sns-stg-static`, `sns-stg-backup`**
- [x] **Secrets Manager 登録**:
  - `sns/stg/django/secret-key`
  - `sns/stg/django/db-password`
  - 他は Phase 進行に合わせて追加

#### 手動作業（ハルナさん側）

- [x] **お名前.com で取得したドメインを Route53 に NS 委任**（NS レコード更新）
- [x] **ACM 証明書の DNS 検証（自動で Route53 にレコード追加）**

#### アプリケーション

- [x] **Django ヘルスチェックエンドポイント `/api/health/`**
- [x] **Next.js Hello World ページ `/`**
- [x] **Dockerfile（production）確認**（既存あれば流用）
- [x] **nginx リバースプロキシ設定確認**

#### CI/CD

- [x] **GitHub Actions OIDC IAM Role 作成**（静的 AWS キー不使用）
- [x] **`.github/workflows/cd-stg.yml` 作成**:
  - main マージ → Build → ECR push → ECS update
  - ECS run-task で DB マイグレーション
- [x] **stg 初回デプロイ実行**（`terraform apply` → ECS サービス起動確認）

#### ドキュメント

- [x] **`docs/operations/stg-deployment.md` 作成**（運用手順）
- [x] **`docs/adr/0002-fulltext-search-backend.md` 作成**（pg_bigm 仮採用の記録）

### 並列化候補

- 5 つの Terraform module は **相互依存あり**（network → data/compute → edge）だが、個々のモジュール内は独立
- Hello World アプリ実装と Terraform module は完全並行可能

### 受け入れ基準

- [x] `terraform apply` で stg が一から構築可能
- [x] `https://stg.<domain>` で Next.js Hello World が表示
- [x] `https://stg.<domain>/api/health/` で Django ヘルスチェック `200 OK`
- [x] main ブランチマージで stg が自動更新
- [x] CloudWatch Logs にアプリログが集約
- [x] Sentry に stg からのエラーが届く

---

## Phase 1: 認証・プロフィール・基本ツイート

### 目的

ログイン → プロフィール設定 → ツイート投稿の最小限 SNS 体験を実現。

### タスク

#### バックエンド

- [x] User モデル拡張（display_name, bio, avatar, header, job_role, country, prefecture, years_of_exp, 各種 URL, is_bot, is_premium, premium_expires_at）
- [x] `@handle` バリデーション強化（英数+`_`、3〜30字、**変更不可**）
- [x] Google OAuth 実装（`social-auth-app-django` + djoser 統合）
- [x] `apps/tags` 実装（Tag, UserSkillTag, UserInterestTag）
- [x] **タグ新規作成時の編集距離チェック**（Levenshtein 距離 ≤ 2 で候補表示、公式タグに近ければブロック）
- [x] タグシード投入（management command: `seed_tags`）
- [x] プロフィール API（GET/PATCH）、アイコン・ヘッダー画像アップロード
- [x] `apps/tweets` 実装（Tweet, TweetImage, TweetTag, TweetEdit）
- [x] ツイート CRUD API
  - 作成: Markdown バリデーション、タグ最大 3、画像最大 4、編集距離チェック
  - 編集: 30 分以内・5 回まで（X 準拠）、TweetEdit 履歴保存
  - 削除: 物理削除、削除済みツイートへの参照は「削除されたツイートです」
- [x] Markdown レンダリング（`markdown2` + `bleach` + Shiki）
- [x] 文字数カウントロジック（Markdown 記号除外、URL 23 文字換算）
- [x] DRF Throttle 初期配線（スパム階層の 100/500/1000 閾値）

#### フロントエンド

- [x] ログイン / サインアップ画面
- [x] プロフィール初期設定ウィザード
- [x] プロフィール編集画面 + アイコン円形クロップ（`react-easy-crop`）
- [x] ツイート投稿コンポーザー（Markdown プレビュー、タグ入力サジェスト、画像添付、文字数カウント）
- [x] ツイート詳細ページ `/tweet/<id>`（**未ログイン閲覧可**）
- [x] プロフィールページ `/u/<handle>`（**未ログイン閲覧可**）
- [x] タグページ `/tag/<name>`（**未ログイン閲覧可**）
- [x] ツイート編集 UI（30 分以内のみ活性、履歴表示）

#### インフラ

- [x] S3 メディアバケットへのアップロード配線（django-storages）
- [x] Sentry tag: `phase=1`

### 並列化候補

- バックエンド API と フロントエンド UI は高度に並行可能
- User モデル → Tag モデル → Tweet モデル は直列、それぞれの API + UI は並行

### 受け入れ基準

- [x] メール / Google でサインアップ・ログイン・ログアウト
- [x] プロフィール項目編集、アイコン円形クロップ
- [x] 180 字 + Markdown + 画像 4 枚 + コードブロック + タグ 3 でツイート投稿
- [x] 30 分以内に 5 回まで編集可能、履歴表示
- [x] タグ編集距離チェックが動作
- [x] 未ログインで個別ツイート・プロフィール・タグページが閲覧可能
- [x] Phase 末に stg へデプロイ、動作確認

---

## Phase 2: TL・リアクション・フォロー・検索

### タスク（要点のみ）

#### 全文検索 PoC（Phase 冒頭 1〜2 日）

- [x] **pg_bigm / pg_trgm CREATE EXTENSION migration** (P2-02 #177、F-15 内包、本セッション完了)
- [ ] **pg_bigm + Lindera での日本語検索精度検証**（ADR-0002 を更新、P2-01 別セッション）
- [ ] 要件を満たさない場合は Meilisearch 移行を決定（P2-01 別セッション）

#### バックエンド

- [x] `apps/follows`（Follow + unique/check constraints） ← P2-03 #178 ✅ (本セッション完了)
- [x] `apps/reactions`（10 種、1 user 1 tweet 1 種） ← P2-04 #179 ✅ (本セッション完了)
- [x] Tweet に Repost / Quote / Reply 追加 ← P2-05 #180 ✅ (本セッション完了)
- [x] Repost / Quote / Reply API ← P2-06 #181 ✅ (本セッション完了)
- [x] OGP カード自動取得（Celery、24h キャッシュ） ← P2-07 #182 ✅ (本セッション完了)
- [x] TL 配信（フォロー 70% + 全体 30%、**fan-out-on-read + Redis キャッシュ**、ヒット率目標 85%） ← P2-08 #183 ✅ (本セッション完了)
- [x] トレンドタグ集計（Celery Beat 30 分ごと） ← P2-09 #184 ✅ (本セッション完了)
- [x] おすすめユーザー API（興味関心 → リアクション → フォロワー多い順） ← P2-10 #185 ✅ (本セッション完了)
- [ ] `apps/search` 実装（pg_bigm or Meilisearch）、Django signals で同期 ← P2-11 (別セッション)
- [ ] 検索 API（`tag:` / `from:` / `since:` / `until:` / `type:` / `has:`） ← P2-12 (別セッション)

#### フロントエンド

- [x] ホーム TL（アルゴリズム / フォロー中タブ） ← P2-13 #186 ✅
- [x] リアクション UI（10 種、キーボード代替 Alt+Enter 対応） ← P2-14 #187 ✅
- [x] RT / 引用 RT / リプライ UI ← P2-15 #188 ✅
- [x] 検索画面 ← P2-16 #207 ✅
- [x] トレンドタグ / おすすめユーザーサイドバー ← P2-17 #189 ✅ (実装あり、UI バグは別 issue で修正中)
- [x] 「もっと見る」展開（X 準拠） ← P2-18 #190 ✅
- [x] 未ログイン用 `/explore` ← P2-19 #191 ✅

#### Phase 2 follow-ups (2026-05-05 セッション)

検索・リアクション周辺の bug fix / UX 改善・ドキュメント整備。

- [x] **ユーザールーティング 404 fix**: `/api/v1/users/popular/` `/recommended/` が `<str:username>/` greedy に飲まれて 404 を返していた問題を解消 (#370 → PR #371)
- [x] **TweetCard SSR 500 fix**: `isomorphic-dompurify` server-side で落ちる問題を解消、DOMPurify を client-only に遅延適用 (#375 → PR #376)
- [x] **Navbar グローバル検索**: 画面上部の Navbar から常時検索できるように (X 風) (#377 → PR #378)
- [x] **リアクション仕様書群**: `docs/specs/reactions-spec.md` / `reactions-scenarios.md` / `reactions-e2e-commands.md` を新規作成 (#374)
- [x] **検索仕様書群**: `docs/specs/search-spec.md` / `search-scenarios.md` / `search-e2e-commands.md` を新規作成 (#374)
- [x] **リアクション popup close**: 選択後・outside click・Escape で閉じる (#379 → PR #380)
- [x] **リアクション Facebook 風 UX**: click=quick toggle (like)、長押し=picker (#381 → PR #382)
- [x] **reaction_summary 埋め込み + 内訳表示**: tweet レスポンスに集計 + viewer 別 my_kind を含め、TweetCard 下部にブレイクダウンを表示 (#383 → PR #384)
- [x] **ReactionSummary リアルタイム反映**: 総計件数 (`· N 件`) 撤去、リロードせず即時更新 (#385 → PR #386)
- [x] **like を Facebook 風 ThumbsUp icon に**: `❤️` から白抜き → 青塗り SVG に (#387 → PR #388)
- [x] **WhoToFollow shape unwrap**: backend `{user, reason}` per row を frontend がフラットと誤解していたのを修正 (#390 → PR #391)
- [x] **ROADMAP frontend tasks 進捗チェック**: P2-13〜P2-19 の checkbox 更新 (PR #389)
- [x] **avatar クリックでプロフィール遷移 (X 風)**: TL / WhoToFollow の avatar も name と同じ動線へ (#392 → PR #393)
- [x] **WhoToFollow に display_name + bio を追加**: アイコンだけでなく名前と自己紹介も表示 (#392 → PR #393)
- [x] **popular / recommended から is_active=False を除外**: `/u/<handle>` 404 になるユーザがおすすめ枠に出ていた問題 (#394 → PR #395)
- [x] **ホーム UI/UX 再構成 (X 風 3 カラム)**: 投稿は左下 + ボタンのポップアップ、検索は RightSidebar 上部、ホームから inline composer 撤去 (#396)
- [x] **「投稿しました」トースト二重発火を解消**: ComposeTweetDialog と TweetComposer が両方 toast 発火していた (#398)
- [x] **おすすめユーザー relaxed fallback**: 候補が limit に満たない時、自分・blocked のみ除外して埋める Step 4 fallback を追加。基本表示 5 → 3 に (#399)
- [x] **単純リポストの cascade soft-delete**: 元投稿 soft_delete 時に type=REPOST も同時に is_deleted=True に。tombstone「このツイートは削除されました」が TL に残らない (#400)
- [x] **WhoToFollow キャッシュ invalidate hook**: follow/unfollow 時に WTF Redis cache を消す + management command 追加 (#404)
- [x] **Navbar 整理 1**: 右上 AuthAvatar/ThemeSwitcher 撤去、設定を LeftNavbar SettingsMenu へ集約、popular で self 除外 (#406)
- [x] **Navbar 整理 2**: Navbar 全体を撤去 → ロゴを LeftNavbar 上部へ、WhoToFollow フォロー後 dismiss、ボタン文言「フォロー」短縮 (#408)
- [x] **WhoToFollow フォロー中除外**: relaxed fallback (#399) を撤回、recommended/popular とも認証済 viewer の既フォローを除外 (#410)

### Phase 4A 先行実装 (2026-05-06 セッション)

- [x] **通知システム (X 風 6 種別)**: Notification モデル + signals + API + LeftNavbar Bell + 未読バッジ + /notifications ページ + Playwright E2E spec (#412)
  - kind: like / repost / quote / reply / mention / follow
  - dedup 24h、self-notify guard、mention 抽出 (`MAX_MENTION_NOTIFY=10`)
- [x] **NotificationSetting (種別 ON/OFF UI)**: model + GET/PATCH API + `is_kind_enabled_for` で create_notification 段階 skip + `/settings/notifications` page + ToggleSwitch + SettingsMenu リンク (#415)
- [x] **通知グループ化 (X 流「他 N 人」)**: like/repost/follow を recipient × target × 7 日 bucket で集約、actors[] / actor_count / row_ids をレスポンス、frontend は上位 3 人 + 「他 N 人」表示 + click で row_ids 一括既読 (#416)
  - 残 (別 Issue): WebSocket リアルタイム、DM/ARTICLE kind (Phase 3/5 連動)、dangling target cleanup、block/mute 連動 filter (Phase 4B 完了後)

### 受け入れ基準

- [x] フォロー関連機能完動
- [x] TL 配信 70:30 アルゴリズム動作
- [x] 検索がフィルタ演算子付きで動作
- [x] Phase 末に stg へデプロイ

---

## Phase 3: DM（リアルタイム）

### タスク

#### バックエンド

- [ ] `apps/dm` モデル実装
- [ ] Django Channels セットアップ（ASGI, Routing, Consumer）
- [ ] 招待フロー API（作成・承諾・拒否）
- [ ] **S3 プリサインド URL 方式での直アップロード** (H-6)
  - フロント → S3 直接アップロード
  - 完了後に URL だけサーバーへ送信
  - Django 経由での大容量アップロードを禁止（Channels イベントループ保護）
- [ ] 既読管理（`last_read_at`）

#### フロントエンド

- [ ] DM 一覧 / 個別画面
- [ ] WebSocket 接続、**reconnecting-websocket で再接続**
- [ ] タイピング中表示（3 秒超で `role="status"` 一回告知、A11Y 準拠）
- [ ] 既読マーク
- [ ] 画像・ファイルプレビュー（S3 直アップロード）
- [ ] グループ作成フロー、招待通知 → 承諾/拒否 UI

### 受け入れ基準

- [ ] 1:1 + グループ（最大 20 名）DM リアルタイム動作
- [ ] 既読・タイピング表示正常
- [ ] S3 プリサインド URL 経由で画像・ファイル送信成功
- [ ] Phase 末に stg へデプロイ、WebSocket が ALB 経由で動作

---

## Phase 4A: 通知・お気に入りボックス

### タスク

- [x] `apps/notifications`（Notification）← #412 (NotificationSetting は別 Issue)
- [x] 各イベントから通知生成（Django signals、6 種別 like/repost/quote/reply/mention/follow）← #412 (DM*\*/ARTICLE*\* は Phase 3/5 と連動)
- [ ] WebSocket 通知（`/ws/notifications/`）← 別 Issue (本 Issue は 30s polling)
- [x] 通知 API（一覧・既読マーク）← #412
- [ ] `apps/boxes`（FavoriteBox, BoxItem）
- [x] 通知ベル UI（未読バッジ、A11Y 準拠 `aria-label`）← #412
- [x] 通知一覧画面 ← #412 / 設定画面（種別 ON/OFF）← 別 Issue
- [ ] ボックス一覧・詳細、ブックマーク操作

### 受け入れ基準

- [x] 各イベントで通知発火 (#412 で 6 種別、Phase 3/5 で残り 4 種別追加予定) / 種別 ON/OFF は別 Issue
- [ ] お気に入りボックスが非公開で動作

---

## Phase 4B: モデレーション

### タスク

- [x] `apps/moderation`（Block, Mute, Report）← #443 #444 #446
- [x] **Block/Mute を TL・検索・DM クエリに反映**（横断タスク）← #445 (Block は既存 lazy-import 活性化、Mute は timeline + notifications に新規組込)
- [x] 通報 API + Django admin で管理画面 ← #446
- [x] ユーザー設定画面: ブロック・ミュート操作 ← #450
- [x] 通報フォーム（ツイート/記事/DM/板レス/ユーザー）← #449 (現状 tweet / user 対応、article/message/thread_post は API 受付済で UI 露出は将来)
- [x] Profile kebab menu (X 風 ⋯ メニュー) ← #448
- [x] throttle scope 3 種 (block/mute/report) ← #447
- [x] frontend API client + Playwright E2E spec ← #451 #452

### 受け入れ基準

- [x] ブロック・ミュートが全クエリに反映 (timeline + notifications + follows + dm)
- [x] 通報が管理画面に集約、resolved/dismissed フラグで管理可 (admin で bulk action)
- [x] backend pytest 32 件 + 既存 149 件 全緑、frontend RTL + API helpers 11 件全緑
- [x] python-reviewer の BLOCK 2 + WARN 4 反映済
- [x] PR #453 squash merge 済、cd-stg deploy 進行中

### Phase 4B 残作業 (本 Phase スコープ外、別 follow-up issue)

- Phase 5 (boards) への Block/Mute 反映 (boards-spec §1.2 の TODO)
- Reaction (`apps/reactions`) への Block 適用
- 「リカロートを非表示」(Hide reposts only) — Block ほど強くない独立概念
- Block 同時実行レース (python-reviewer WARN #1)
- admin re-resolve 仕様確認 (python-reviewer WARN #3)

---

## Phase 5: 掲示板

### タスク

- [x] `apps/boards`（Board, Thread, ThreadPost, ThreadPostImage） ← #425
- [x] 板 CRUD は Django admin のみ ← #425
- [x] スレッド・レス API（ログイン必須、1000 レスで lock） ← #426 #427 #428 #429 #436
- [x] 板一覧 `/boards`、板詳細、スレッド詳細（**未ログイン閲覧可**） ← #432 #433
- [x] 新規スレ作成フォーム ← #434
- [x] レス投稿フォーム（未ログイン時は CTA） ← #434
- [x] `@handle` メンション通知 ← #431
- [x] 画像 S3 presigned PUT URL 発行 + serializer 検証 ← #430
- [x] Playwright E2E spec + 仕様書 (boards-{spec,scenarios,e2e-commands}.md) ← #437

### 受け入れ基準

- [x] 未ログインで閲覧可能 (BO-01..BO-03 で確認)
- [x] 1000 レスで自動 lock (services.append_post + 990 警告フラグ)
- [x] 管理者のみスレ削除 (Django admin の bulk action、本人不可)
- [x] backend pytest 63 件緑 / frontend RTL 7 件緑 / tsc clean / eslint clean
- [x] local API E2E (curl) 主要 8 シナリオ全 pass: 板一覧 / スレ作成 (201) / 匿名 detail / メンション通知 / 削除権限 (本人 204、他人 403) / Web Board CRUD 拒否 (405) / 5 枚目画像 400 / post_count 不変
- [x] PR #438 起票、CI green 確認後 stg デプロイ予定

---

## Phase 6: 記事機能（GitHub 片方向 push のみ）

### タスク

#### バックエンド

- [ ] `apps/articles`（Article, ArticleTag, ArticleImage, ArticleLike, ArticleComment）
  - **UNLISTED 状態は実装しない**（Q2 で限定公開を除外）
- [ ] 記事 CRUD API
- [ ] Markdown → HTML レンダリング + XSS ペイロードテストセット
- [ ] 記事画像 S3 アップロード（プリサインド URL 方式）
- [ ] **GitHub 連携 push-only**（Q1）:
  - OAuth で `public_repo` スコープ取得
  - 記事保存時に `articles/<slug>.md` を push
  - 画像は `images/<slug>/` 配下に push
  - **GitHub Webhook / pull 方向は実装しない**
  - OAuth トークンは `cryptography.fernet` で暗号化保存
- [ ] 記事公開時の自動ツイート（設定で ON/OFF）
- [ ] ArticleLike / ArticleComment

#### フロントエンド

- [ ] 記事作成・編集画面（Markdown エディタ、プレビュー、画像 D&D）
- [ ] 記事一覧 `/articles`
- [ ] 記事詳細 `/articles/<slug>`（**未ログイン閲覧可**、OGP / JSON-LD 出力）
- [ ] いいね・コメント UI
- [ ] GitHub 連携設定画面（連携 ON/OFF、リポジトリ選択）
- [ ] 記事由来ツイートの 📄 マーク表示（Phase 2 UI 更新）

### 受け入れ基準

- [ ] 下書き / 公開 の 2 段階（限定公開なし）
- [ ] GitHub 連携 ON で push が正しく動作
- [ ] 記事公開時に自動ツイート、📄 マーク付き
- [ ] OGP / JSON-LD 出力

---

## Phase 7: Bot（RSS + AI 要約）

### タスク

- [ ] `apps/bots`（RSSSource, PostedArticle）
- [ ] Bot ユーザー作成（`@itmedia_bot`, `@hn_bot`）
- [ ] Celery Beat で 30 分ごとに RSS 取得
- [ ] 重複検知（URL SHA-256 を Redis Set、30 日 TTL）
- [ ] OpenAI `gpt-4o-mini` で:
  - 国内: 要約 + 感想 + 関連タグ 3 個
  - 海外: 翻訳 + 要約 + 感想 + タグ 3 個
- [ ] **プロンプト試行錯誤 + NSFW / 政治系フィルタ**（planner レビュー追加）
- [ ] ツイート生成・投稿（`type=bot_news`, 記事リンク付き）
- [ ] レート制限（1 ソース 1 時間 1 件）
- [ ] **コスト監視ダッシュボード**（OpenAI API 使用量）

### 受け入れ基準

- [ ] 両 Bot が 30 分周期で投稿
- [ ] 重複投稿なし
- [ ] 翻訳 + 要約品質が人間レビューで合格
- [ ] 月コスト $30 以内

---

## Phase 8: プレミアム機能（Stripe + 記事 AI）

### タスク

- [ ] `apps/billing`（Subscription, PremiumUsage）
- [ ] Stripe Checkout セッション作成 API
- [ ] **Stripe Webhook**:
  - エンドポイント: `webhook.stg.example.com/stripe`（**CloudFront 非経由**）
  - 署名検証必須
  - 冪等性（イベント ID を Redis に保存して重複処理防止）
  - `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed` 処理
  - Webhook 失敗時の fallback（Stripe API 直接問い合わせ）
- [ ] User.`is_premium`, `premium_expires_at` 同期
- [ ] 記事下書き AI 生成 API（Claude `claude-sonnet-4-6`, 月 30 回制限）
- [ ] プロフィールバッジ表示
- [ ] ツイート文字数拡張（180 → 500）
- [ ] プレミアムプラン紹介ページ、購読フロー、キャンセル UI

### 受け入れ基準

- [ ] 月額 ¥500 / 年額 ¥5,000 で購読可能
- [ ] Webhook 冪等性テスト合格
- [ ] プレミアム会員限定機能が活性化
- [ ] 解約後は期間終了まで利用可、終了後自動失効

---

## Phase 9: 本番昇格・負荷試験・Lighthouse CI

> stg は各 Phase 末で既に稼働しているので、このフェーズは**本番環境の立ち上げ**と**品質ゲート強化**。

### タスク

- [ ] `terraform/environments/prod/` 追加
  - RDS を Multi-AZ 化
  - ElastiCache を Multi-AZ replica 1
  - ECS Fargate Min 2 / Max 10 Auto Scaling
  - NAT を NAT Gateway に変更
- [ ] 本番ドメイン ACM 取得
- [ ] 本番 Secrets Manager 登録（新規 API キー取得）
- [ ] 負荷試験（Locust or k6）:
  - TL 配信 100 同時ユーザー
  - DM WebSocket 1000 同時接続
- [ ] Lighthouse CI を GitHub Actions に組込（スコア閾値）
- [ ] WAF 導入（CloudFront 前段）
- [ ] **本番初回デプロイ**

### 受け入れ基準

- [ ] 本番環境で各機能が動作
- [ ] 負荷試験合格
- [ ] Lighthouse スコア > 90（ホーム・記事・プロフィール）

---

## Phase 10: Claude Design 取り込み・a11y 監査・SEO

### 目的

全機能が揃った状態で、ハルナさんが Claude Design に全体を見せてデザインシステムを生成、本 SNS に取り込んで UI 仕上げ。

### タスク

- [ ] **Claude Design で全体 UI のデザインシステム生成**（ハルナさん主導）
- [ ] **handoff bundle を Next.js + Tailwind へ反映**
  - デザイントークン（色・タイポ・余白）を `tokens.css` に上書き
  - コアコンポーネント（Button / Input / Card / Avatar / Tag / Dialog）を置換
  - shadcn/ui コンポーネントと整合
- [ ] ビジュアルリグレッションテスト（Playwright + スクリーンショット）
- [ ] **アクセシビリティ監査**（a11y-architect レビュー実施）
  - axe-core Playwright 統合
  - Lighthouse a11y スコア 95+
  - 手動 NVDA / VoiceOver テスト
  - 実ユーザーテスト（スクリーンリーダー利用者）
- [ ] パフォーマンス最適化:
  - `next/image` 全面適用
  - OGP 画像自動生成
- [ ] SEO:
  - sitemap.xml / robots.txt
  - JSON-LD (Article, Person, WebSite schema)
- [ ] 全 320/640/768/1024/1280 ブレークポイント確認

### 受け入れ基準

- [ ] Claude Design bundle が本番 UI に反映
- [ ] WCAG 2.2 AA 準拠
- [ ] Lighthouse 全スコア 90+

---

## サブエージェント活用マトリクス

各 Phase で以下のサブエージェントを PR 時に並列起動:

| サブエージェント      | 使用タイミング                   | 役割                                  |
| --------------------- | -------------------------------- | ------------------------------------- |
| `python-reviewer`     | すべての Python PR               | PEP8・型ヒント・Python 特有の落とし穴 |
| `typescript-reviewer` | すべての TS PR                   | 型安全・React ベストプラクティス      |
| `code-reviewer`       | すべての PR                      | 汎用コード品質                        |
| `security-reviewer`   | 認証 / 決済 / 権限 / 外部 API PR | OWASP Top 10                          |
| `database-reviewer`   | マイグレーション含む PR          | クエリ最適化・N+1・インデックス       |
| `a11y-architect`      | フロント PR、Phase 10            | WCAG 準拠                             |
| `tdd-guide`           | 新機能 PR                        | テスト先行の強制                      |
| `architect`           | Phase 0.5, 9                     | Terraform・AWS 設計レビュー           |
| `planner`             | Phase 境界                       | 次フェーズ計画の整合性チェック        |
| `doc-updater`         | Phase 完了時                     | SPEC/ER/ARCHITECTURE の更新           |

---

## リスク・未解決事項

| #   | リスク/課題                                  | 影響                              | 対応方針                                                                                                                                         |
| --- | -------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Claude Design の handoff bundle 仕様が未確認 | Phase 10 で予期せぬ取り込みコスト | Phase 8 頃に Claude Design を試運転                                                                                                              |
| 2   | GitHub push-only だがコンフリクト時の挙動    | ユーザー体験低下                  | ドキュメントで「GitHub はバックアップ用途」と明示                                                                                                |
| 3   | Hacker News 翻訳時のコスト                   | 月 $10-30 だが RSS 頻度で膨張     | gpt-4o-mini 利用 + 頻度上限 + コスト監視                                                                                                         |
| 4   | pg_bigm 日本語検索精度                       | ユーザー体験低下                  | Phase 2 冒頭で PoC、不足なら Meilisearch 移行                                                                                                    |
| 5   | stg 予算 ¥25k で想定超                       | コスト増                          | 毎月コスト確認、Interface Endpoints を必要最小に                                                                                                 |
| 6   | Bot 翻訳記事の著作権                         | 法的リスク                        | 要約+感想中心、元リンク必須、法務確認 Phase 7 前                                                                                                 |
| 7   | Django Channels + ALB WebSocket sticky 運用  | 接続不安定                        | Phase 0.5 で ALB idle_timeout=3600 確認、再接続実装                                                                                              |
| 8   | Celery Beat の二重実行                       | バッチ重複                        | 単一タスク固定・Spot 不可、冪等性設計                                                                                                            |
| 9   | RDS t4g.micro の容量限界                     | 性能劣化                          | fan-out-on-read 設計、キャッシュヒット率監視                                                                                                     |
| 10  | Next.js ISR / 未ログインページキャッシュ戦略 | 更新反映遅延                      | **Phase 2 TL 配信と同時に検討** (doc-updater 指摘: CloudFront 配信は Phase 0.5 で開始済みのため Phase 10 では遅い)、CloudFront cache policy 調整 |
| 11  | 退会時の物理削除と外部キーカスケード         | データ不整合                      | Phase 1 でカスケード設計、外部参照は SET_NULL                                                                                                    |
| 12  | Meilisearch 選択時の永続化方式               | データ消失リスク                  | Phase 2 PoC 時に EBS + 日次スナップショット確定                                                                                                  |

---

## 次のアクション

1. **ハルナさんが GitHub リポジトリ方針を決定**（新規 or 既存流用）
2. **`gh auth login`** でセッション認証
3. `docs/WORKFLOW.md` 確認
4. Phase 0 + 0.5 の Issue 一括発行（`gh issue create` × 30 件程度）
5. Phase 0 着手（最初の worktree を切って実装開始）
