# CLAUDE.md

> Claude Code が新しい会話で最初に読むプロジェクトメモ。
> **実装着手前にこのファイル → 該当 Phase の `docs/issues/phase-N.md` → 関連 SPEC を読む。**
> 詳細は重複させず、すべて既存ドキュメントへリンクで誘導する。

---

## 1. このプロジェクトは何か

**エンジニア特化型 SNS**（日本語話者のソフトウェアエンジニア向け）。
X (旧 Twitter) をベースに、コードスニペット投稿・技術タグ・Zenn ライク記事・5ch ライク掲示板を統合した SNS。

> リポジトリ名は歴史的経緯で `haruna0712/claude-code` だが、**Claude Code 本体ではなく SNS アプリ** が中身。
> 上流 Claude Code の README は [docs/CLAUDE_CODE.md](./docs/CLAUDE_CODE.md) に退避済み。

オーナー: ハルナさん（プロジェクトオーナー、最終承認権限）。

---

## 2. ドキュメント索引（必ずここから辿る）

| 知りたいこと                                              | 読むべきファイル                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| プロジェクト全体像・セットアップ・コマンド                | [README.md](./README.md)                                                                         |
| 機能仕様（認証/ツイート/DM/記事/掲示板）                  | [docs/SPEC.md](./docs/SPEC.md)                                                                   |
| データモデル設計 (ER 図・計画モデル)                      | [docs/ER.md](./docs/ER.md)                                                                       |
| 現在のDBスキーマ一覧                                      | [docs/db-schema.md](./docs/db-schema.md)                                                         |
| 実際の DB テーブル定義                                    | `apps/*/models.py` と `apps/*/migrations/*.py`。Django の実装・migration が最終的な正本          |
| OpenAPI / API 型生成                                      | [docs/operations/api-codegen.md](./docs/operations/api-codegen.md)。schema 正本は `/api/schema/` |
| **インフラ仕様（AWS stg 構成）**                          | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                                                   |
| インフラ運用 Runbook 群                                   | [docs/operations/](./docs/operations/) (infrastructure / ci-cd / dns / oauth / 各種 runbook)     |
| **実装ロードマップ・現在の Phase**                        | [docs/ROADMAP.md](./docs/ROADMAP.md)                                                             |
| **開発ワークフロー（Issue-First / worktree / レビュー）** | [docs/WORKFLOW.md](./docs/WORKFLOW.md)                                                           |
| 各 Phase の Issue ドラフト                                | [docs/issues/phase-N.md](./docs/issues/)                                                         |
| アーキテクチャ意思決定 (ADR)                              | [docs/adr/](./docs/adr/)                                                                         |
| アクセシビリティ戦略 (WCAG 2.2 AA)                        | [docs/A11Y.md](./docs/A11Y.md)                                                                   |
| サブエージェントレビュー統合結果                          | [docs/REVIEW_CONSOLIDATED.md](./docs/REVIEW_CONSOLIDATED.md)                                     |

---

## 3. 現在の Phase / 進捗の確認方法

**Phase ごとの状態は [docs/ROADMAP.md](./docs/ROADMAP.md) §0.2 のテーブルが正本。**
着手前に必ずそこで現 Phase を確認する（このファイルには書かない、二重管理になるため）。

リアルタイムな Issue 状況は GitHub から:

```bash
gh api repos/:owner/:repo/milestones --jq '.[] | "\(.title): open=\(.open_issues) closed=\(.closed_issues)"'
gh issue list --milestone "<現 Phase のマイルストーン名>" --state open
```

---

## 4. 開発ワークフロー（必ず守る）

詳細: [docs/WORKFLOW.md](./docs/WORKFLOW.md)。要点だけ:

### 4.1 1 Issue を実装する標準サイクル

**毎回この順番でエージェントを使う。逐一聞かない。**

```
1. Issue 確認        → gh issue view / 無ければ gh issue create で起票
2. 関連ドキュ精読    → docs/issues/phase-<N>.md の該当 issue + SPEC.md の関連章
3. worktree 作成     → git worktree add .worktrees/issue-<N>-<slug> -b feature/issue-<N>-<slug>
4. TDD 実装          → tdd-guide エージェント を呼ぶ (Red → Green → Refactor、カバレッジ 80%+)
5. UI なら実機確認   → docker compose の dev サーバ + Playwright / browser MCP で golden path とエッジケース
6. レビュー並列起動  → 下記マトリクスに従って複数エージェントを 1 メッセージ内 parallel call
7. CRITICAL/HIGH 修正
8. ドキュメント更新  → doc-updater エージェント または該当 docs/* を直接編集
9. Conventional Commit → squash merge 前提で 1 PR = 意味のある 1 機能
10. PR 作成          → gh pr create、CI / サブエージェント自動レビュー待ち
11. CI 緑 + レビュー無問題 → そのまま `gh pr merge --squash` で **マージしてよい** (人間レビュー待ち不要、ただし下記「マージ前ブロッカー」確認)
12. マージ後         → cd /workspace && git worktree remove ... && git branch -d ...
```

### 4.1.1 マージ前ブロッカー (どれか 1 つでも該当ならマージ停止 → ハルナさんに相談)

- CI が **fail** している (lint / test / type / build のいずれか)
- サブエージェントが **CRITICAL** を出して未解消（CRITICAL が「本 PR 範囲外、別 Issue 起票済」なら blocker ではない）
- terraform apply / 本番 secret 書き込み / DB データ移行 / 課金エンドポイントなど **本番影響度が高く事後 revert がきかない** 変更
- スコープが膨れて **500 行を大幅に超え**、レビュー難易度が上がっている

それ以外は **テスト緑なら自動でマージ → 自動で push** してよい (Revert 済の再投入であっても、PR 本文に Revert 経緯と差分を明記してあれば OK)。ハルナさんが事後に確認する運用。

### 4.2 レビューエージェント選択マトリクス

| 触ったもの                       | 必ず呼ぶ                                |
| -------------------------------- | --------------------------------------- |
| Python / Django (apps/, config/) | `python-reviewer` + `code-reviewer`     |
| TypeScript / Next.js (client/)   | `typescript-reviewer` + `code-reviewer` |
| UI コンポーネント                | + `a11y-architect`                      |
| 認証 / 認可 / 入力 / 課金        | + `security-reviewer`                   |
| DB マイグレ / クエリ / モデル    | + `database-reviewer`                   |
| 大きな機能 / リファクタ          | + `code-architect` で設計レビュー       |
| サイレント失敗が混入しそう       | + `silent-failure-hunter`               |

→ 独立して読めるレビューは **必ず 1 メッセージ内で parallel に並列起動**。逐次起動禁止。

### 4.3 Phase 開始時の Issue 起票完備（planner エージェント）

**新しい Phase に着手する前に、その Phase で必要な Issue が GitHub にすべて起票されている状態を作る。** 抜けがあると後から「あの機能が無いまま閉じた」になる。これを Claude が忘れないための運用:

1. **`docs/issues/phase-<N>.md` のドラフトを精読**して、起票漏れがないか `gh issue list --milestone "Phase <N>: ..."` と突き合わせる
2. ドラフト自体が不完全な場合は **`planner` エージェント** を呼んで Phase スコープを SPEC.md / ROADMAP.md / ARCHITECTURE.md と照合し、不足 Issue ドラフトを生成させる
3. `./scripts/create-issues.sh phase-<N>` で一括起票、または個別 `gh issue create`
4. 「先送り」を意図的に決めた Issue も **明示的に起票** して `priority:low` などラベル付けする (フリーズ抜け防止)
5. これが終わるまで Phase の実装着手しない

### 4.4 共通ルール

- **Issue-First**: コード着手前に GitHub Issue。1 Issue = 1 PR = 1 feature branch
- **着手前に必ず読む**: `docs/issues/phase-<現Phase>.md` と関連 SPEC 章。**いきなり書き始めない**
- **Small PR**: 1 PR は 1 日以内 / 500 行以内が目安。L 以上は分割
- **git worktree 並列化**: メイン `/workspace/` は **main 固定**。Docker Compose は main でのみ起動（ポート衝突回避）
- **TDD 徹底**: Red → Green → Refactor、カバレッジ 80% 以上
- **Squash and merge**、**Conventional Commits**（`feat(scope): ...` / `fix(scope): ...`）
- ブランチ命名: `feature/issue-<N>-<slug>` / `fix/...` / `infra/...` / `docs/...` / `chore/...`
- PR タイトル例: `[feature][tweets] Tweet モデルの基本 CRUD API を実装 (#12)`

---

## 5. GitHub 運用

- **リポ**: `haruna0712/claude-code`（Public）
- **デフォルトブランチ**: `main`
- **Issue テンプレート**: [.github/ISSUE_TEMPLATE/](./.github/ISSUE_TEMPLATE/) (bug / feature / docs / infra / model_behavior)
- **ラベル体系**: `type:* / area:* / priority:* / layer:* / status:*` ([WORKFLOW.md §1.1](./docs/WORKFLOW.md))
- **マイルストーン**: Phase 0 〜 Phase 10（Phase 完了とともに進む）
- **Issue 一括発行**: `./scripts/create-issues.sh phase-<N>`（初回は `create-labels.sh` / `create-milestones.sh`）
- **CI**: [.github/workflows/](./.github/workflows/) — ruff / mypy / eslint / tsc / pytest / vitest / terraform plan
- **gh CLI 必須**: `gh auth login` 済みであること

よく使う:

```bash
gh issue list --milestone "Phase 2: TL・リアクション・検索" --state open
gh issue view <番号>
gh pr create --fill --assignee @me
```

---

## 6. 技術スタック早見表

| レイヤー       | 採用                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| バックエンド   | Django 4.2 + DRF + djoser + Channels + Celery                                   |
| フロントエンド | Next.js 14 (App Router) + Tailwind + shadcn/ui                                  |
| DB             | PostgreSQL 15 (+ pg_bigm + pg_trgm)                                             |
| キャッシュ/MQ  | Redis 7（local）/ ElastiCache（stg）                                            |
| インフラ       | Terraform → ECS Fargate / ALB / CloudFront / RDS / Route53                      |
| CI/CD          | GitHub Actions（OIDC → AWS）                                                    |
| 観測性         | Sentry + structlog (JSON)                                                       |
| 認証           | JWT (HttpOnly Cookie) — [ADR-0003](./docs/adr/0003-jwt-httponly-cookie-auth.md) |

---

## 7. ローカル起動（詳細は README §開発環境のセットアップ）

```bash
# 起動（メイン /workspace でのみ）
docker compose -f local.yml up -d --build
docker compose -f local.yml exec api python manage.py migrate

# 主要 URL
# Next.js (UI):    http://localhost:8080/
# Django API:      http://localhost:8080/api/v1/
# OpenAPI schema:  http://localhost:8080/api/schema/
# Swagger UI:      http://localhost:8080/api/schema/swagger-ui/
# ReDoc:           http://localhost:8080/api/schema/redoc/
# Legacy ReDoc:    http://localhost:8080/redoc/
# Admin:           http://localhost:8080/supersecret/
# Mailpit:         http://localhost:8025/
# Flower (Celery): http://localhost:5555/

# テスト
docker compose -f local.yml exec api pytest
cd client && npm run lint && npx tsc --noEmit
```

---

## 8. 着手前チェックリスト（Claude Code 自身向け）

- [ ] このファイルと **該当 Phase の `docs/issues/phase-N.md`** を読んだ
- [ ] 関連する SPEC.md / ER.md / ARCHITECTURE.md の章を確認した
- [ ] 着手 Issue が **GitHub に存在する**（無ければ起票してから）
- [ ] 既存の **open issue / open PR と被っていない**ことを `gh issue list` / `gh pr list` で確認した
- [ ] 並列実行可なら **`.worktrees/` で worktree を切る**、共有設定（settings.py / package.json / local.yml）を触る Issue は単独で進める
- [ ] **テストを先に書く**（TDD）
- [ ] PR 作成時は **サブエージェントレビューを並列起動**
- [ ] `/workspace` の main ブランチへ直接 commit しない（PR 経由）

---

## 9. 注意事項・地雷

- **`terraform apply` / NS 委任 / 本番 secret 書き込みはハルナさん手動オペレーション**。Claude は plan までで止める。
- **Sentry DSN が空のローカルビルド**で `SENTRY_ENVIRONMENT=production` を立てると Next.js build が失敗する。ローカルは未設定 or `local`。
- **worktree 内で venv / node_modules は別管理**。Python 依存が worktree 間で異なるとハマる。
- **マイグレーション番号**は worktree 並列で衝突しがち。先にマージされた worktree 基準で rebase する。
- 上流 Claude Code 由来のファイル（`plugins/`, `examples/`, `Script/`, `.claude-plugin/`, `CHANGELOG.md` 等）は **SNS 本体とは無関係**。改変しない。
- ライセンスは現状 Anthropic Commercial Terms（fork 経緯）。Phase 9 以降で MIT / Apache-2.0 化検討予定。

---

## 10. このファイルの更新ルール

- **進捗・ステータス・日付・Issue 番号など揮発する情報は書かない**（正本は ROADMAP.md / GitHub）
- 新しい運用ルール / 地雷が判明したら §9 に追記
- 詳細はここに書かず、`docs/` または `docs/operations/` に移して **リンクで参照**
- 200 行を超えたら章ごとに `.claude/rules/*.md` への分割を検討
