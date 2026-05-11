# typography .prose 装飾の修復 (#605)

> 関連 Issue: #605
> 関連 PR: TBD
> 種別: bug fix (frontend)

## 1. 背景

`gan-evaluator` agent による Phase 6 article 機能の実画面採点 (6.3/10) で、HIGH 重大度バグ H1 として発見。

記事詳細 (`/articles/<slug>`) や記事エディタの preview pane では Markdown 表示に `.prose` Tailwind class が使われているが、`@tailwindcss/typography` plugin が `client/package.json` / `client/tailwind.config.ts` のどちらにも登録されていないため、`prose` class が一切 CSS rule に解決されず、見出し / list / blockquote / code-block の装飾が完全に欠落していた。

### 影響範囲

`prose` class を使う場所 (`grep -rn 'prose '` で確認済):

| ファイル                                            | 用途                             |
| --------------------------------------------------- | -------------------------------- |
| `client/src/components/articles/ArticleBody.tsx:29` | 記事詳細ページの本文表示         |
| `client/src/lib/markdown/preview.tsx:45`            | 記事エディタの live preview pane |
| `client/src/components/timeline/TweetCard.tsx:469`  | tweet card の Markdown 本文      |

3 箇所すべてで装飾が崩れている (= 記事も tweet も影響を受ける) 状態だった。

## 2. 直し方

### 採用するアプローチ

`@tailwindcss/typography` (公式) plugin を dev 依存に追加し、`tailwind.config.ts` の `plugins` 配列に登録する。これだけで `prose`、`prose-sm`、`prose-neutral`、`dark:prose-invert` などの全ユーティリティが利用可能になる。

### 採用しない選択肢

- **自前 CSS で .prose を再現する**: 装飾 spec が複雑 (見出しの margin / link color / list bullet / code-block の inline + block 両対応など) で工数がかかる上、Tailwind の design token 連動 (例えば dark mode) を再実装する手間が無駄。
- **prose class を全部 unprose な markup に置換**: 既に 3 ファイル / 多数の Markdown 表示箇所で `prose` 前提のため、剥がすほうがリスクが高い。

### バージョン

`@tailwindcss/typography@^0.5.10` (Tailwind v3.3 と互換)。

## 3. 受け入れ基準

- [ ] `client/package.json` の `devDependencies` に `@tailwindcss/typography` が追加されている
- [ ] `client/tailwind.config.ts` の `plugins` に `require("@tailwindcss/typography")` が含まれている
- [ ] `npx tsc --noEmit` が通る
- [ ] `npm run lint` で typography 由来の新規エラーが発生しない
- [ ] `npm test` 既存 vitest が緑
- [ ] stg (https://stg.codeplace.me) 上で `/articles/<published-slug>` を開き、見出し (`#`, `##`)、bullet list (`-`)、blockquote (`>`)、inline code (`` ` ``)、code-block (` ``` `) がすべて装飾されているのが目視で確認できる
- [ ] エディタ (`/articles/new`) の preview pane でも同様の装飾が効いている

## 4. テスト

### Unit / Snapshot

Tailwind plugin 追加のみのため固有ロジックはなく、新規 vitest 追加は不要。既存 vitest が緑のままなら回帰なし。

### E2E (Playwright on stg)

新規 spec を追加する必要は薄い (装飾は視覚効果で、E2E で assertion を書くと壊れやすい)。代わりに gan-evaluator 再採点で HIGH H1 が解消されているのを確認する。

### Visual Check (Claude 自身が踏む)

`PLAYWRIGHT_BASE_URL=https://stg.codeplace.me` で `client/e2e/articles-publish-detail.spec.ts` を流して回帰がないことを確認しつつ、Playwright MCP / Chrome で `/articles/<slug>` を開いて screenshot を撮り、見出しと list が装飾されているのを目視確認する。

## 5. ロールアウト

- `fix/issue-605-typography` branch で PR を出し、squash merge
- CI 緑なら自動マージ可 (本番影響度は dev 依存追加 + Tailwind plugin 追加のみで low)
- main merge 後 5 〜 10 分で CD が stg を更新するので、再採点 / 目視確認はそのタイミング
