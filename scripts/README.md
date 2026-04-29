# scripts/

リポジトリ内で使う運用スクリプトの集まり。各スクリプトの先頭にもコメントが
書かれているが、本書では一覧と用途のサマリを提供する。

## 一覧

| ファイル                                                      | 用途                                                              | 実行タイミング                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| [`bootstrap-tf-state.sh`](./bootstrap-tf-state.sh)            | terraform S3 backend (state bucket + DynamoDB lock) を初期化      | 環境を新しく立てる最初に 1 回だけ             |
| [`export-claude-session.py`](./export-claude-session.py)      | Claude Code セッション JSONL を読みやすい markdown にエクスポート | Stop hook で自動 (応答完了ごと)、手動実行も可 |
| [`create-issues.sh`](./create-issues.sh)                      | docs/issues/ から `gh issue create` でまとめ作成                  | 必要時                                        |
| [`create-labels.sh`](./create-labels.sh)                      | プロジェクト共通ラベルを `gh label create` でまとめ作成           | リポジトリ初期化時                            |
| [`create-milestones.sh`](./create-milestones.sh)              | Phase ごとのマイルストーンを `gh api` でまとめ作成                | リポジトリ初期化時                            |
| [`edit-issue-labels.sh`](./edit-issue-labels.sh)              | 既存 issue へラベルを後付け一括追加                               | 必要時                                        |
| [`issue-lifecycle.ts`](./issue-lifecycle.ts)                  | Phase 終了時に該当 issue を自動 close                             | Phase 完了時 / GitHub Action から             |
| [`comment-on-duplicates.sh`](./comment-on-duplicates.sh)      | 重複 issue 検出 + 重複コメントを自動投下                          | issue triage 時                               |
| `auto-close-duplicates.ts` / `backfill-duplicate-comments.ts` | duplicate detection の TypeScript 実装                            | GitHub Action から                            |
| [`gh.sh`](./gh.sh)                                            | gh CLI の薄いラッパ (リポジトリ・トークン解決)                    | 他のスクリプトから利用                        |
| [`sweep.ts`](./sweep.ts)                                      | リポジトリ全体の cleanup タスクハーネス                           | 定期実行                                      |
| [`lifecycle-comment.ts`](./lifecycle-comment.ts)              | issue lifecycle event のコメント生成                              | issue-lifecycle.ts から呼ばれる               |

---

## Claude Code セッションログを残す (`export-claude-session.py`)

### 何をするか

ハルナさんと Claude の対話を読み物形式の Markdown に保存する。コンソールに
表示された対話の流れがほぼそのまま残るので、後から振り返り・引き継ぎ・
検索に使える。出力先はプロジェクト直下の `conversations/` (gitignore 済)。

```
conversations/
├── 2026-04-29-dfcf4c86.md   ← ファイル名は <日付>-<セッション UUID 先頭 8 桁>
├── 2026-04-29-cec883f0.md
└── ...
```

### 自動実行 (Stop hook)

`.claude/settings.json` の `Stop` hook に登録済。**Claude が 1 ターンの応答を
返すたびに自動で markdown が再生成される** (idempotent、毎回上書き)。

ハルナさん以外の contributor も:

1. このリポジトリを clone + Reopen in Container
2. 何か Claude にプロンプトを投げて応答が返ってくる

…それだけで `conversations/` に勝手に MD が作られる。設定は repo の
`.claude/settings.json` に入っているので、devcontainer 共通でみんな同じ挙動。

### 手動実行

```sh
# 最新セッションを export
python3 scripts/export-claude-session.py

# 特定セッションを export (UUID 先頭数文字で OK)
python3 scripts/export-claude-session.py dfcf4c86

# 最近 10 セッションのリスト表示
python3 scripts/export-claude-session.py --list
```

### 出力フォーマット

````markdown
# Claude Code セッションログ — dfcf4c86

> セッション ID: `dfcf4c86-25bf-44ef-b834-095ad967f62a`
> 開始: 2026-04-29
> 自動生成: 2026-04-29 17:45:23 JST

## 👤 User · 14:22:35

phase1で作ったのは API でしたっけ？...

## 🤖 Assistant · 14:22:42

良い質問。確認してから答えます。

<details><summary>🔧 Bash</summary>

```bash
gh issue list --repo ...
```
````

</details>

ありがとう、確認します。テスト inventory ...

```

ツール呼び出しは `<details>` で折りたたみ。GitHub の MD viewer でクリックすると
展開できる。VSCode/Cursor の Markdown preview でも同様。

### 注意

- `conversations/` は `.gitignore` 済 — 個人ログなので push しない
- 1 セッション = 1 MD ファイル。長くなると数 MB になることもある
- セッションが 24h 以上開かれっぱなしの場合も、Stop hook が走るたびに最新化される
- Claude Code の元 JSONL (`~/.claude/projects/-workspace/*.jsonl`) は AI 自身が読み書きしないが、本スクリプトは読み取り専用で参照するだけ
```
