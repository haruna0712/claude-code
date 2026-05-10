# 開発ワークフロー（Issue-First + git worktree 並列化）

> Version: 0.1
> 最終更新: 2026-04-21
> 関連: [ROADMAP.md](./ROADMAP.md)

## 0. 基本原則

1. **Issue-First**: コード着手前に GitHub Issue を発行。1 Issue = 1 PR = 1 feature branch。
2. **Small PR**: 1 PR は **1 日以内で実装・レビューできる粒度**（目安 < 500 行変更）。
3. **git worktree 並列化**: 独立性の高い Issue は別 worktree で同時進行。
4. **サブエージェント並列レビュー**: PR ごとに該当サブエージェントを並列起動。
5. **Phase 末に stg デプロイ**: 各 Phase 完了時点で stg に反映、本番的な挙動を検証。

---

## 1. GitHub Issue 体系

### 1.1 ラベル体系

**type:\***（種別）

- `type:feature` — 新機能
- `type:bug` — バグ修正
- `type:refactor` — リファクタリング
- `type:docs` — ドキュメント更新
- `type:infra` — インフラ・Terraform
- `type:ci` — GitHub Actions / pre-commit
- `type:chore` — ビルド・依存管理

**area:\***（機能領域）

- `area:auth` / `area:profile` / `area:tweets` / `area:tags` / `area:timeline`
- `area:reactions` / `area:follow` / `area:search` / `area:dm` / `area:notifications`
- `area:boxes` / `area:moderation` / `area:boards` / `area:articles` / `area:bots`
- `area:billing` / `area:a11y` / `area:seo`

**priority:\***

- `priority:critical` — 即対応
- `priority:high` — 当該 Phase 内で必須
- `priority:medium` — 当該 Phase 内で対応
- `priority:low` — 余裕があれば

**layer:\***（技術レイヤ）

- `layer:backend` — Django
- `layer:frontend` — Next.js
- `layer:infra` — AWS / Terraform
- `layer:ci-cd` — GitHub Actions

**status:\***

- `status:blocked` — 依存 Issue 未完了で進行不可
- `status:in-review` — PR レビュー中
- `status:help-wanted` — 協力求む

### 1.2 マイルストーン

| マイルストーン                              | 対応 Phase |
| ------------------------------------------- | ---------- |
| `Phase 0: 基盤整備`                         | Phase 0    |
| `Phase 0.5: 最小 stg デプロイ`              | Phase 0.5  |
| `Phase 1: 認証・プロフィール・基本ツイート` | Phase 1    |
| `Phase 2: TL・リアクション・検索`           | Phase 2    |
| `Phase 3: DM`                               | Phase 3    |
| `Phase 4A: 通知・ボックス`                  | Phase 4A   |
| `Phase 4B: モデレーション`                  | Phase 4B   |
| `Phase 5: 掲示板`                           | Phase 5    |
| `Phase 6: 記事機能`                         | Phase 6    |
| `Phase 7: Bot`                              | Phase 7    |
| `Phase 8: プレミアム`                       | Phase 8    |
| `Phase 9: 本番昇格`                         | Phase 9    |
| `Phase 10: Claude Design 取り込み`          | Phase 10   |

### 1.3 Issue タイトル規約

```
[<type>][<area>] <動作形の短い説明>
```

例:

- `[feature][tweets] Tweet モデルの基本 CRUD API を実装`
- `[infra][ci-cd] stg 用 GitHub Actions OIDC ロールを作成`
- `[refactor][search] pg_bigm クエリビルダーを共通化`

### 1.4 Issue 本文テンプレート

`.github/ISSUE_TEMPLATE/` に用意します（後述）。主要項目:

```markdown
## 目的

（何を達成したいか）

## 背景

（なぜ必要か、仕様書のどこに該当するか）
関連: SPEC.md §X.Y, ER.md §Z

## 作業内容

- [ ] サブタスク1
- [ ] サブタスク2

## 受け入れ基準

- [ ] 〇〇が動作する
- [ ] テストが 80% 以上通る
- [ ] code-reviewer / security-reviewer が承認

## 依存

- blocked by #N
- related to #M

## 見積

S (< 4h) / M (4-8h) / L (1-2d) / XL (要分割)

## 並列化可否

- [ ] 他 Issue と並列実装可能
- [ ] 直前に完了すべき Issue: #N
```

---

## 2. git worktree 並列化

### 2.1 ディレクトリ構造

メインリポジトリは `/workspace/`（main ブランチ固定）。worktree は `.worktrees/` 配下に作成:

```
/workspace/                         ← メイン (main ブランチ)
/workspace/.worktrees/              ← worktree ルート
  issue-001-add-python-deps/        ← 1 worktree = 1 ブランチ
  issue-002-add-npm-deps/
  issue-003-scaffold-apps/
  issue-010-tf-network-module/
```

`.gitignore` に `.worktrees/` を追加（既に main リポで無視）。

### 2.2 コマンド基本形

```bash
# 新しい worktree を作成してブランチを切る
git worktree add .worktrees/issue-001-add-python-deps -b feature/issue-001-add-python-deps

# worktree に移動して作業
cd .worktrees/issue-001-add-python-deps

# 作業・コミット
# ...

# PR push
git push -u origin feature/issue-001-add-python-deps

# PR 作成
gh pr create --fill --assignee @me

# マージ後、worktree を削除
cd /workspace
git worktree remove .worktrees/issue-001-add-python-deps
git branch -d feature/issue-001-add-python-deps
```

### 2.3 並列化の決定ルール

Issue が並列実行**可能**な条件:

| 基準                                                                           | OK  |
| ------------------------------------------------------------------------------ | --- |
| 編集するファイルが被らない                                                     | ✅  |
| DB マイグレーションが干渉しない                                                | ✅  |
| 依存関係（`blocked by`）がない                                                 | ✅  |
| 共有設定ファイル（`settings.py`, `package.json`, `local.yml`）を同時編集しない | ✅  |

**被る場合の処理**:

- 依存元 Issue を先にマージ、依存先は rebase
- もしくは 1 Issue に統合（粒度見直し）

### 2.4 並列実行の具体例

**Phase 0 の並列化プラン**（3 worktree 同時進行可）:

| worktree           | Issue                   | 影響ファイル                                           |
| ------------------ | ----------------------- | ------------------------------------------------------ |
| `wt-deps-python`   | [#1] Python 依存追加    | `requirements/base.txt` のみ                           |
| `wt-deps-npm`      | [#2] npm 依存追加       | `client/package.json`, `client/package-lock.json` のみ |
| `wt-scaffold-apps` | [#3] 13 アプリ scaffold | `apps/*/__init__.py`, `apps/*/models.py` 等            |

上記 3 つを 3 並列で実装し、順次マージ。完了後:

| worktree           | Issue                         | 依存      |
| ------------------ | ----------------------------- | --------- |
| `wt-observability` | [#4] Sentry + structlog 配線  | #1 完了後 |
| `wt-design-tokens` | [#5] デザイントークン初期配置 | #2 完了後 |

### 2.5 注意事項

- **worktree 内でも venv は別管理**が推奨（Python 依存が worktree 間で異なる場合）
- `client/node_modules` も同様。`pnpm` か `npm ci` で再インストール
- Docker Compose は**メイン `/workspace/` でのみ起動**し、worktree は編集専用にする（ポート衝突を避ける）
- **ブランチ名とディレクトリ名を一致**させる（混乱防止）

---

## 3. ブランチ戦略

- `main`: 本番相当。直接 push 禁止（PR 経由のみ）
- `develop`: 開発統合ブランチ（オプション、最初は main 直運用でも可）
- `feature/issue-<N>-<slug>`: 機能開発
- `fix/issue-<N>-<slug>`: バグ修正
- `infra/issue-<N>-<slug>`: インフラ変更
- `docs/issue-<N>-<slug>`: ドキュメント
- `chore/issue-<N>-<slug>`: 依存更新・雑務

### PR のタイトル規約

Issue タイトルと揃える:

```
[feature][tweets] Tweet モデルの基本 CRUD API を実装 (#12)
```

### Conventional Commits

コミットメッセージ:

```
feat(tweets): add Tweet model CRUD endpoints

Implement POST/GET/PATCH/DELETE for /api/tweets/.
Includes 180-char validation and tag limit (3).

Closes #12
```

---

## 4. PR プロセス

### 4.1 PR 作成

```bash
gh pr create --title "[feature][tweets] Tweet モデルの基本 CRUD API を実装 (#12)" --body-file <(cat <<'EOF'
## 関連 Issue
Closes #12

## 概要
...

## テスト
- [ ] 単体テスト追加
- [ ] 結合テスト追加
- [ ] ローカルで動作確認

## スクリーンショット
（UI 変更時のみ）

## サブエージェントレビュー
自動実行対象:
- [ ] python-reviewer
- [ ] code-reviewer
- [ ] security-reviewer
- [ ] database-reviewer
EOF
)
```

### 4.2 自動レビュー

PR 作成時に GitHub Actions が以下を並列実行:

- Lint (ruff, mypy, eslint, tsc, prettier)
- Test (pytest + vitest + coverage)
- Terraform plan（インフラ変更時のみ）
- サブエージェント呼び出し（該当するもの）

### 4.3 人間レビュー

- サブエージェントが CRITICAL を出した場合はマージブロック
- HIGH 以下は警告、起票者判断で対応
- 最終承認はハルナさん（プロジェクトオーナー）

### 4.4 マージ戦略

- **Squash and merge** を原則（履歴がきれい）
- 大きな機能の複数 PR を 1 commit に潰したくない場合のみ Merge commit

---

## 5. Issue 発行オペレーション

### 5.1 一括発行スクリプト

各 Phase のドラフト Issues は `docs/issues/phase-<N>.md` に記述。承認後、以下スクリプトで一括発行:

```bash
# 例: docs/issues/phase-0.md に記述した Issue を一括発行
./scripts/create-issues.sh phase-0
```

スクリプトは `gh issue create --title ... --body ... --label ... --milestone ...` を Issue 毎に実行。

### 5.2 Issue 記述形式

`docs/issues/phase-0.md` の中身は以下の形式で Issue が並ぶ:

```markdown
---
## [feature][infra] Python 追加パッケージを requirements に導入

**Labels**: `type:chore`, `layer:backend`, `priority:high`
**Milestone**: `Phase 0: 基盤整備`
**Estimate**: S (< 4h)
**Parallel**: ✅ (他 deps 追加と並行可)

### 目的
Phase 1 以降で必要となる Python 依存を一括導入する。

### 作業内容
- [ ] `requirements/base.txt` に以下を追加:
  - `channels>=4`, `channels-redis>=4`, `daphne>=4`
  - ...（略）
- [ ] `docker compose build api` で依存解決確認

### 受け入れ基準
- [ ] `docker compose up` で api コンテナが起動
- [ ] `python -c "import channels"` が成功
...

---

## [feature][infra] Frontend 追加パッケージを package.json に導入

...
```

### 5.3 Issue 順序の決定

- 依存順にナンバリング
- 並列実行可能な Issue は `parallel: ✅` で明示
- 各 Issue の冒頭で **依存先 Issue 番号** を明記

---

## 6. サブエージェント運用

### 6.1 自動起動

`.github/workflows/ci.yml` 内で PR 作成時に Claude Code CLI を起動し、該当エージェントを呼ぶ:

```yaml
- name: Security Review
  if: contains(github.event.pull_request.labels.*.name, 'area:auth') ||
    contains(github.event.pull_request.labels.*.name, 'area:billing')
  run: |
    claude -p "security-reviewer エージェントで PR #${{ github.event.pull_request.number }} をレビュー" \
      --permission-mode acceptEdits \
      --output-format json > review-result.json
```

### 6.2 レビューの格付け

| 深刻度   | ふるまい                                  |
| -------- | ----------------------------------------- |
| CRITICAL | PR マージブロック（GitHub Check failing） |
| HIGH     | マージ可だが起票者・レビューワーで判断    |
| MEDIUM   | 情報提示のみ                              |
| LOW      | 参考情報                                  |

---

## 7. この開発フローでの典型的な 1 日

```
08:30  朝: TaskList で今日着手する Issue を確認
08:45  worktree 作成 → コーディング開始
11:00  PR 1 本目作成 → 自動レビュー待ち
11:30  別 worktree で次の Issue 着手
14:00  PR 1 本目レビュー結果を反映 → マージ
14:30  PR 2 本目作成
17:00  stg へのデプロイ確認（Phase 末なら）
17:30  明日の Issue 準備（依存解消、新 Issue 発行）
```

---

## 8. よくある失敗と回避

| 失敗                                                                                                 | 回避策                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Issue が大きすぎて PR も巨大化                                                                       | 発行時に Estimate が L 以上なら分割を検討                                                                                                                              |
| 並列 worktree でマイグレーション番号衝突                                                             | 先にマージされた worktree 基準で rebase                                                                                                                                |
| settings.py の同時編集で conflict                                                                    | 共有設定変更は 1 Issue に集約                                                                                                                                          |
| サブエージェントの Critical 指摘で PR が詰まる                                                       | 最初の段階でセキュリティ観点を盛り込む                                                                                                                                 |
| stg デプロイで IAM 権限不足発覚                                                                      | Phase 0.5 で最小権限設計を検証                                                                                                                                         |
| 同じファイルを触る複数 PR で rebase が壊れる                                                         | rebase ではなく `git merge origin/main` で 1 回に集約                                                                                                                  |
| pytest のテストパスワード文字列が pre-commit で reject                                               | 文字列に `# pragma: allowlist secret` コメントを付ける                                                                                                                 |
| `git worktree add` 後に node_modules が無くて vitest 失敗                                            | `ln -s /workspace/client/node_modules <worktree>/client/node_modules` で symlink                                                                                       |
| API curl 直叩きで「E2E pass」と主張                                                                  | Playwright で **UI クリック / fill** を踏むまで E2E と呼ばない (#455 反省)                                                                                             |
| pytest が `assert 401 == 403` で fail                                                                | DRF Cookie 認証は WWW-Authenticate header を出さず 403 を返す。test は `(401, 403)` 両方許容                                                                           |
| backend は実装済だが Phase 4A bridge (`apps/notifications/signals.py`) 未実装で通知が `silent no-op` | bridge を resolve できないと dispatch がサイレント no-op になる。新規 dispatch 追加時は **bridge module の存在確認**まで責務に含める (#487 教訓)                       |
| **DOM 上に button 存在 = ユーザに見える、ではない**                                                  | `text-baby_grey + border-baby_grey` のような薄色は dark 背景に溶け込んで視覚的に消える。stg で **目視 visual capture** + 色コントラスト確認まで責務 (#492 → #496 教訓) |
| 使い捨て tsx スクリプトで「E2E 完了」と主張                                                          | `client/e2e/<feature>.spec.ts` にコミット必須。CI/regression に再利用可能でなければ E2E と呼ばない (#492 → #495 教訓)                                                  |

---

## 10. 機能フォロー追加 (follow-up Issue) のフロー — 本セッション (#469-#496) で標準化

新規機能を追加するときの **9 ステップ** を、本セッション (DM 招待まわり 11 PR) で実証した順番で記載する。各ステップを飛ばさない。

### 10.1 ステップ概要

```
0. 「同じ機能が他のチャットアプリにある？」を最初に調査
1. Issue 起票 (UX 仕様 + やる/やらない + 切り分け表 + テスト方針 + 関連 PR)
2. 仕様書 (docs/specs/<feature>-spec.md) に章を追記 / 新規作成
3. worktree 切る (.worktrees/issue-<N>-<slug>)
4. RED テスト先 (vitest RTL / pytest)
5. GREEN 実装 (backend → frontend → 統合)
6. tsc + eslint + prettier (pre-commit hook が止める)
7. PR 起票 → CI 全 green まで監視 → squash merge
8. CD stg deploy 完了まで監視
9. **stg 実機で UI 操作 + visual capture** (← これを飛ばすと #492 の "削除 button が見えない" 事案を再発する)
10. ROADMAP.md / 仕様書を docs PR で更新 (別 PR で履歴クリーン)
```

### 10.2 「他チャットアプリ調査」 を最初にやる理由

ハルナさんから「他のチャットサービスを参考に」と言われることが多い。先に調査しておけば spec doc に **「他社調査表」** を入れられて、UX 判断の根拠 (なぜこの button が必要か) が PR review で揺れない。

例 (本セッションの #489 / #492 / #470):

| アプリ          | 招待通知 UX                               | kick UX                             | leave UX                      | clipboard paste  |
| --------------- | ----------------------------------------- | ----------------------------------- | ----------------------------- | ---------------- |
| Slack           | 受信箱「Join」 (別画面)                   | Channel admin が member 行 → Remove | Sidebar context menu「Leave」 | preview chip     |
| Discord         | 通知に **inline** Accept/Reject、即時参加 | Server owner / mod → Kick           | Server menu「Leave Server」   | inline thumbnail |
| Microsoft Teams | 通知に「Join」、即時参加                  | Team owner が member 行 → Remove    | Team menu「Leave team」       | inline thumbnail |
| LINE            | 通知に「参加」「拒否」、即時参加          | Admin が member 長押し → 削除       | グループ画面「退会」          | inline thumbnail |

**4 アプリ中 3 アプリで同じパターンなら、それが標準** と判定して spec に書く。1 アプリだけ違っても少数派意見として注釈に留める。

### 10.3 仕様書を **実装より先に** 書く理由

実装してから「ここの動作どうしよう」と判断するのは弱い。先に spec を書けば:

- 「やる / やらない」が明示されて scope creep を防げる
- a11y / 状態遷移 / API 仕様 / テスト方針が PR review 開始時点で揃っている
- 後続 PR (例: #487 通知 bridge → #489 inline action) が同じ doc を編集して章を追加できる
- ハルナさんが「これは仕様で決まってるの？」と聞いたときに即答できる

### 10.4 RED → GREEN は妥協しない

vitest RTL / pytest を **先に書いて fail を確認する** こと。GREEN から始めると "テストが実装に合わせてしまう" 罠を踏む。

```bash
# RED 確認 (component が無い → transform fail で OK)
cd /workspace/.worktrees/<feature>/client && npx vitest run src/components/.../<New>.test.tsx
# 期待: "Test Files 1 failed, Tests no tests" or "element not found"

# 実装後 GREEN
npx vitest run src/components/.../<New>.test.tsx
# 期待: "Test Files 1 passed, Tests <N> passed"
```

### 10.5 stg 実機検証 (最重要、絶対飛ばさない)

CI green + vitest pass + tsc pass **だけ** で機能完成と思わない。本セッションで:

- **#487**: pytest GREEN, code merged。でも `apps/notifications/signals.py` が無くて dm_invite 通知が silent no-op だった。stg で test3 の `/notifications/` を curl 直叩きしたら 0 件で気づいた。
- **#492**: kick 機能の API + UI + vitest 全 GREEN。でも CSS が `text-baby_grey` で button が dark 背景に溶け込んで **視覚的に見えなかった**。ハルナさんから「どこ？削除ボタン」と質問されて発覚 → #496 で `bg-baby_red/10 + text-baby_red` に修正。

実機検証チェックリスト:

- [ ] stg URL を browser でアクセスし、目で UI を確認する (Playwright headless でもよいが、screenshot を `picture/` に保存)
- [ ] destructive action は **赤系**、primary は **青系** など、色コントラストが背景に対して十分か
- [ ] aria-label / role が正しく振られているか (DOM dump で確認)
- [ ] entry point (button / link / shortcut) が **発見できるか** — 自分が初見ユーザだったら見つけられるか
- [ ] エラー系 (4xx / 5xx) を意図的に発生させてみて適切なメッセージが出るか
- [ ] Playwright で UI クリック (setInputFiles / fill / click) を踏むテストを書く。**API curl 直叩きは E2E ではない**

### 10.6 Playwright spec はリポにコミット (使い捨てスクリプト ≠ E2E)

検証の最初の段階で `_verify-foo.ts` のような使い捨て tsx スクリプトを書いてもいいが、機能のリリース時は **必ず `client/e2e/<feature>.spec.ts` にコミット**する。

- リポ内 spec = CI / regression テストとして再利用可能
- 使い捨てスクリプト = 誰も再現できない、検証されたことの証跡が残らない

`ensureMember` / `loginViaApi` のような事前準備 helper を spec 内に書いて、stg DB の状態に依存しない再現性を持たせる (#492 の `dm-kick-leave.spec.ts` 参照)。

### 10.7 PR チェーン管理 (並列で同じファイルを触る場合)

同じファイル (例: `InviteMemberDialog.tsx`) を複数 PR で並列に触ると merge conflict が起きる。

**ベストプラクティス**:

1. 大きな機能を分解した PR は **直列に merge** する。前の PR が merge されるまで次の PR の rebase はしない
2. それでも conflict が起きたら **`git rebase` ではなく `git merge origin/main`** で 1 回で解消 (rebase は commit 単位で順番に適用するため、同じ conflict マーカーを何度も解消する羽目になる)
3. conflict マーカー (`<<<<<<<` / `=======` / `>>>>>>>`) を grep で全件確認してから add / commit

```bash
git fetch origin main
git merge origin/main
# conflict 出たらマーカーを resolve
grep -nE '<<<<<<<|=======|>>>>>>>' <files>  # 全件確認
git add . && git commit -m "merge: main を取り込む"
git push
```

### 10.8 docs PR は別出しにする

機能実装 PR と ROADMAP / spec 更新 PR は **別 PR** で分ける:

- 機能 PR: コード変更 + 該当 spec doc の追加章 (機能の仕様を書く)
- docs PR: ROADMAP の完了チェック反映 + 切り分け表更新 (進捗を反映)

この分け方で git history が「機能追加」「進捗反映」 で読み分けられる。本セッションでは feat PR (#477, #482, #483, ...) と docs PR (#486, #491, #494) で分けた。

### 10.9 命名規約まとめ

- ブランチ: `feature/issue-<N>-<slug>` (新機能) / `fix/issue-<N>-<slug>` (バグ修正) / `chore/<slug>` (テスト追加など) / `docs/<slug>` (ドキュメントのみ)
- worktree: `.worktrees/issue-<N>-<slug>`
- spec doc: `docs/specs/<feature-name>-spec.md` (kebab-case)
- E2E spec: `client/e2e/<feature-name>.spec.ts`
- pytest: `apps/<app>/tests/test_<feature>.py`
- vitest: `client/src/components/<area>/__tests__/<Component>.test.tsx`

### 10.10 worktree セットアップ snippet

```bash
# 切る + node_modules を symlink して vitest を即実行可能に
git worktree add /workspace/.worktrees/issue-<N>-<slug> -b feature/issue-<N>-<slug>
ln -s /workspace/client/node_modules /workspace/.worktrees/issue-<N>-<slug>/client/node_modules

# 後始末
cd /workspace
git worktree remove /workspace/.worktrees/issue-<N>-<slug>
git branch -D feature/issue-<N>-<slug>
```

### 10.11 stg 検証 snippet (Playwright で UI クリック + screenshot)

```typescript
// _verify-<feature>.ts (使い捨て、検証後 rm)
import { chromium } from "@playwright/test";
const BASE = "https://stg.codeplace.me";
const USER = { email: "test2@gmail.com", password: "Sirius01" }; // pragma: allowlist secret -- docs/local/e2e-stg.md 参照

async function login(ctx, user) {
	const r = await ctx.request.get(`${BASE}/api/v1/auth/csrf/`);
	const csrf =
		/csrftoken=([^;]+)/.exec(r.headers()["set-cookie"] ?? "")?.[1] ?? "";
	await ctx.request.post(`${BASE}/api/v1/auth/cookie/create/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/login`,
		},
		data: { email: user.email, password: user.password },
	});
}

(async () => {
	const browser = await chromium.launch({ headless: true });
	const ctx = await browser.newContext({
		viewport: { width: 1440, height: 900 },
	});
	const page = await ctx.newPage();
	await login(ctx, USER);
	await page.goto(`${BASE}/messages/<ROOM_ID>`);
	// UI 操作 + screenshot
	await page.screenshot({ path: "/workspace/picture/<feature>-shot.png" });
	await browser.close();
})();
```

実行後 `picture/<feature>-shot.png` を Read tool で開いて目視確認 → 検証完了したら使い捨てスクリプトを削除し、本番 spec を `client/e2e/` にコミットする。

---

## 11. 参考: 初期 Phase の Issue 発行例

Phase 0 + 0.5 の Issue 発行コマンド例（`scripts/create-issues.sh` 内で実行される内容）:

```bash
gh issue create \
  --title "[chore][infra] Python 追加パッケージを requirements に導入" \
  --body-file docs/issues/bodies/p0-01-python-deps.md \
  --label "type:chore,layer:backend,priority:high" \
  --milestone "Phase 0: 基盤整備"

gh issue create \
  --title "[chore][infra] Frontend 追加パッケージを package.json に導入" \
  --body-file docs/issues/bodies/p0-02-npm-deps.md \
  --label "type:chore,layer:frontend,priority:high" \
  --milestone "Phase 0: 基盤整備"

# ... 以下繰り返し
```
