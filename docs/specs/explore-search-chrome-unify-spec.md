# /explore と /search の chrome を完全一致

> 関連: [Issue #806](https://github.com/haruna0712/claude-code/issues/806), ハルナさん指示 2026-05-19
> #803 (PR #805) の事後修正 — chrome 統合がされてない確認漏れを直す

## 1. 背景

#803 で /explore を 「SearchBox + 最新の投稿」 にリデザインしたが、 ハルナさんの当初要件 「今の /search のページに加えていったん最新の投稿を表示する構成」 を満たしていなかった。 stg 検証でハルナさん指摘:

> 投稿を除いて /search と /explore が一緒になっているか確認した？

実際の差分: /explore は h1「Explore」 だけ、 /search は h1「検索」 + 件数 + tabs + 説明文 + box。 4 要素が /explore に欠けていた。 Claude が chrome 比較を怠った CLAUDE.md §4.5 step 6 違反。

## 2. やること

### 2.1 shared component `SearchExploreSurface`

`client/src/components/search/SearchExploreSurface.tsx` (新規):

- props: `query`, `searchCount`, `searchResults`, `latestTweets`, `currentUser`
- 構造:
  - sticky header: `<h1>検索</h1>` + (q あれば) 「『q』 — N 件」
  - `<SearchModeTabs mode="tweets" query={query} />` (投稿 / ユーザー tabs)
  - 説明文 「投稿本文、 タグ、 投稿者で検索します...」
  - `<SearchBox initialValue={query} />`
  - q あり: `<TweetCardList tweets={searchResults} ariaLabel="「q」の検索結果" />`
  - q なし: `<h2>最新の投稿</h2>` + `<TweetCardList tweets={latestTweets} ariaLabel="最新の投稿" />`

### 2.2 /explore + /search ともに新 component を使う

両方の `page.tsx` を server component のまま、 q を読んで data を Promise.all で取得し SearchExploreSurface に渡す。

- q ありなら `fetchSearch(q)` + 空 latest
- q なしなら 空 search + `fetchLatestTimeline(20)`

### 2.3 検索 box submit 先

- 既存 SearchBox は `/search?q=...` に navigate (現状維持)
- /explore からも /search?q=... に飛ぶ → どちらの URL でも同じ chrome なので URL が違うだけで挙動は同じ
- /explore?q=... で直叩きしても 検索結果を表示 (chrome 統合)

## 3. やらないこと

- /explore と /search の URL 統合 (`/search` redirect to `/explore` 等) — 別 Issue
- /users tab (= /search/users) の中身変更
- 検索 algorithm の変更
- 既存 Playwright spec (`search-nav-rail.spec.ts` / `explore-latest.spec.ts`) の chrome 期待値更新 → #800 に追記して別 PR

## 4. UI 振る舞い

### 4.1 /explore (q なし)

```
[header]  検索
[tabs]    [投稿] [ユーザー]
[hint]    投稿本文、タグ、投稿者で検索します...
[box]     [           ]
          ▶ フィルタ演算子の使い方

[h2]      最新の投稿
[list]    TweetCard / TweetCard / ...
```

### 4.2 /search?q=django (q あり) — /explore?q=django も同じ

```
[header]  検索
          「django」 — 0 件
[tabs]    [投稿] [ユーザー]
[hint]    投稿本文、タグ、投稿者で検索します...
[box]     [django    ]
          ▶ フィルタ演算子の使い方

[results] 一致するツイートはありません。
```

### 4.3 /search (q なし) — /explore と完全に同じ表示

「最新の投稿」 が中央に出る (既存の 「キーワードを入れてください」 placeholder は廃止)。

## 5. テスト

### 5.1 vitest

`client/src/components/search/__tests__/SearchExploreSurface.test.tsx`:

- q なし: h1 + tabs + 説明 + box + h2 「最新の投稿」
- q あり: h1 + 件数 + tabs + box + 検索結果 section、 「最新の投稿」 h2 なし
- chrome は q ありなしに関わらず常に表示
- SearchBox の initialValue が query と同期

### 5.2 Playwright E2E

`client/e2e/explore-search-chrome-unify.spec.ts` (新規):

- 両 URL で h1 「検索」 / tabs / 説明文 / SearchBox visible
- q なし: 両 URL で 「最新の投稿」 h2 visible
- q あり: 両 URL で 「『q』 — N 件」 visible、 「最新の投稿」 h2 はない
- anonymous でも 両 URL 200

### 5.3 stg 実行コマンド

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
  npx playwright test e2e/explore-search-chrome-unify.spec.ts --reporter=line
```

anonymous OK で credential 不要。

### 5.4 Claude による事後検証 (必須)

stg 反映後、 Playwright MCP で:

1. /explore (anonymous) の full-page スクショ
2. /search (anonymous) の full-page スクショ
3. /explore?q=django の full-page スクショ
4. /search?q=django の full-page スクショ
5. **4 枚を並列比較して chrome (投稿以外) が完全一致していることを目視確認**
6. ハルナさんに 4 枚並べて見せて確認をもらう

## 6. 受け入れ基準

- [ ] /explore と /search の chrome (h1 + 件数 + tabs + 説明 + box + フィルタ) が完全一致
- [ ] /explore?q=foo と /search?q=foo の中央 content (検索結果) が同じ
- [ ] /explore と /search (どちらも q なし) で 「最新の投稿」 が中央に出る
- [ ] vitest 4 ケース pass
- [ ] Playwright spec pass
- [ ] reviewer 直列 (typescript-reviewer + code-reviewer) CRITICAL/HIGH なし
- [ ] **Claude が Playwright MCP で 4 枚スクショ + chrome 一致確認** (#803 の確認漏れの reflection)

## 7. リスク

- /search (q なし) の挙動が変わる (旧: 「キーワード入れて」 placeholder、 新: 最新の投稿 feed)。 ユーザー混乱の可能性は低いが metadata.description の content と consistent
- /explore?q=... と /search?q=... が同じ content なので SEO 上 canonical 問題 → 別 issue (#803 で言及済み)
