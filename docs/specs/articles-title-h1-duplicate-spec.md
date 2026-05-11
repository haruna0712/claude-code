# 記事 title と body 先頭 h1 の重複警告 (#616)

> 関連 Issue: #616
> 関連 PR: TBD
> 種別: UX fix (frontend)

## 1. 背景

`gan-evaluator` 再採点 (2026-05-11) MEDIUM-NEW-1: 記事詳細で title が body 先頭 `# title` と同じだと **H1 が二重に描画** され、 視覚的に違和感がある。

実例として E2E 投稿で test 用に「タイトル == body の `# タイトル`」 だった record が stg に複数あり、 詳細ページで `<h1>EDIT-LOOP-1 self</h1>` の直下に また `<h1>EDIT-LOOP-1 self</h1>` が出ていた。

## 2. 採用するアプローチ

**editor で inline warning を出す (silent strip しない)**。

- author の意図的な選択は妨げない (warning のみで publish はブロックしない)
- render 時に勝手に消すと「なぜ消えたか分からない」 magic 動作 (option 2) — 採用しない
- 検出条件: body の最初の non-blank 行が `# <text>` で、 `<text>` を trim + lowercase した値が title の trim + lowercase と一致する場合のみ

判定は pure function `detectBodyH1MatchesTitle(title, body) -> string | null` に切り出して unit test しやすくする。

### Warning の表示

body textarea の help 文 (`画像はドラッグ&ドロップ…`) の下に黄色の info bar:

> タイトルと本文 1 行目「# <h1 text>」 が同じです。 詳細ページで見出しが二重に表示される可能性があります。

`role="status"` + `aria-live="polite"` で screen reader にも通知。

## 3. 採用しない選択肢

- **render 時に body 先頭 h1 を strip**: 上記の通り magic 動作。 「なぜ消えた?」 サポート question が増える。
- **publish を block**: 重複 h1 は accessibility 違反ではない (heading 順序破綻するわけではない)。 推奨度低の cosmetic な指摘なので block は過剰。
- **toast で警告**: toast は ephemeral で気付かないことがある。 inline で常時表示のほうが UX 良い。

## 4. 受け入れ基準

- [ ] editor で title=「Hello」、 body 1 行目=「# Hello」 のとき warning が表示
- [ ] body=「# hello」 (大文字小文字 違い) でも warning (lowercase 比較)
- [ ] body 1 行目が「## Hello」 (h2) なら warning **無し**
- [ ] body 1 行目が「# World」 (text 違い) なら warning 無し
- [ ] body が空 / title が空 のときは warning 無し (誤検知防止)
- [ ] warning が出ても publish は通る (block しない)
- [ ] vitest で 9 ケース (T-H1-DUP-1..9) 緑

## 5. テスト

### Unit (vitest)

`detectBodyH1MatchesTitle` の 9 ケース:

| ID         | 条件                                           | 期待    |
| ---------- | ---------------------------------------------- | ------- |
| T-H1-DUP-1 | title=Hello, body=`# Hello\n\nbody`            | "Hello" |
| T-H1-DUP-2 | title=Hello, body=`# hello\n\nbody` (大小違い) | "hello" |
| T-H1-DUP-3 | title=`  Hello  ` (前後 ws)                    | "Hello" |
| T-H1-DUP-4 | body 先頭 blank line `\n\n# Hello`             | "Hello" |
| T-H1-DUP-5 | h2 (`## Hello`)                                | null    |
| T-H1-DUP-6 | h1 text 違い (`# World`)                       | null    |
| T-H1-DUP-7 | h1 なし                                        | null    |
| T-H1-DUP-8 | title 空                                       | null    |
| T-H1-DUP-9 | body 空                                        | null    |

### 視認 (Playwright MCP / stg)

stg merge 後、 `/articles/new` で title=「Hello」 + body=`# Hello`\n本文 を入力 → 黄色 warning bar が表示。 body を「# 概要」 に変えると消える。 重複 published 記事 (例 EDIT-LOOP-1) の詳細ページに行って `<h1>` が依然 2 個並ぶ (silent strip しないため意図通り) ことを確認。

## 6. ロールアウト

- `fix/issue-616-title-h1-duplicate` branch で PR、 CI 緑 → squash merge
- stg CD 反映後 Playwright MCP で warning 表示確認
- gan-evaluator 再採点で MEDIUM-NEW-1 解消 (warning 設置で「気付ける」 状態) を確認
