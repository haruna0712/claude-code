# 左 nav 「探索」→「検索」 + /search 右 rail 追加

> 関連: [Issue #795](https://github.com/haruna0712/claude-code/issues/795)
> 既存 spec の更新: [explore-search-rightrail-spec.md](./explore-search-rightrail-spec.md) (§3.4 抑制リスト)
> 経緯: [#741](https://github.com/haruna0712/claude-code/issues/741) の判断を一部再調整

## 1. 背景

ハルナさん指示 (2026-05-18):

- 左 nav の 「探索」 を 「検索」 に rename
- 左 nav の link 先を `/search` に変更
- ただし `/explore` route は残す
- `/search` の画面表示を `/explore` に合わせる (= 右 rail を追加)

#741 で「nav は 1 entry (= 探索)、 rail に search panel を統合」 で X 準拠化したが、 ハルナさんの product 判断として 「検索」 を一級 entry にする方向に方針転換。 rail の search panel は #741 で既に削除済みなので、 `/search` で rail を出しても重複問題は再発しない。

## 2. やること

### 2.1 左 nav の rename + path 変更

`client/src/constants/index.ts`:

```diff
@@ docstring 抜粋 @@
- * #741 で「検索」 entry を削除、 「探索」 icon を Search (虫眼鏡) に統一。
- * Twitter 準拠 IA: search は /explore の component で、 nav 上は 1 entry のみ。
+ * #741 で「検索」 entry を削除して「探索」 に統一したが、 #795 で再調整:
+ * nav の入口は 「検索」 (path: /search)。 /explore は route は残るが nav 外へ。
+ * rail に search panel を戻さないため `/search` に rail を出しても重複しない。

  {
-     path: "/explore",
-     label: "探索",
+     path: "/search",
+     label: "検索",
      iconName: "Search",
  },
```

### 2.2 /search の右 rail 抑制を解除

`client/src/lib/layout/focused-surfaces.ts` の `shouldHideRightRail` 判定から `/search` を外す:

```diff
- "/search",
- "/search/*",
```

(具体 path に応じて。 ファイル内の正規表現 / startsWith 配列のスタイルに合わせる)

合わせて関連 spec `docs/specs/explore-search-rightrail-spec.md` §3.4 の抑制リストから `/search` 行を削除し、 #795 の経緯を 1 行追記する。

### 2.3 /search の page (`client/src/app/(template)/search/page.tsx`)

- 既存 chrome (header / SearchBox / SearchModeTabs / TweetCardList) は維持
- (template) layout から `ARightRail` が自動で挟まれるので **page 側の追加変更は不要**
- 視認確認: `<div className="p-5">` 中央の幅が rail と重なって読みづらくないか (3.4 で検証)

### 2.4 /explore は変更なし (path は残す)

- route は削除しない。 既存 SearchBox + trending feed + (logged-out) HeroBanner はそのまま
- docstring の #741 注記を 「nav からは /search を指すが /explore も維持」 と 1 行追記

## 3. やらないこと

- `/explore` / `/search` の SEO canonical 整理 (両 URL が同等 chrome で indexing 制御要する場合は別 Issue)
- `/search` の q なし時に trending feed を出す統合案 (ハルナさん指示は rail 追加まで、 中央統合は scope 外)
- ARightRail に search panel を戻す
- `/explore` への redirect

## 4. UI 振る舞い

### 4.1 デスクトップ (1280+)

```
[Left nav]    [center: SearchBox / 結果 / SearchModeTabs]    [Right rail: TrendingTags + WhoToFollow]
ホーム
検索 ← click → /search 着地、 右 rail が見える
通知
...
```

### 4.2 モバイル (375)

- 右 rail は `lg:block` で非表示 (既存挙動維持)
- 中央 column のみ表示。 SearchBox / 結果 / SearchModeTabs はそのまま

### 4.3 /explore (直叩き)

- nav にはないが URL 直叩き可
- 既存 chrome (SearchBox + trending feed + 右 rail + (logged-out) HeroBanner) は維持

### 4.4 /search で空クエリ

- 既存通り 「上のボックスにキーワードを入れて検索してください」 メッセージ
- 右 rail (Trending + WhoToFollow) は表示される ← 本 Issue で新規

### 4.5 未ログイン

- /search も /explore も 200 (匿名閲覧可)
- right rail の WhoToFollow は `isAuthenticated={false}` を受けて 「Login して見る」 系の表示に切り替わる (既存挙動)

## 5. テスト

### 5.1 vitest 単体

- `constants/index.ts` を import して `leftNavLinks` を assertion:
  - 「検索」 entry が存在し path は `/search`
  - 「探索」 entry は存在しない
- `focused-surfaces.test.ts` (なければ新設):
  - `shouldHideRightRail('/search')` → `false`
  - `shouldHideRightRail('/messages')` → `true` (regression 確認)

### 5.2 Playwright E2E

ファイル: `client/e2e/search-nav-rail.spec.ts` (新設)

```ts
import { test, expect } from "@playwright/test";

test.describe("Search nav rename + right rail (#795)", () => {
	test("左 nav 「検索」 click → /search 着地 + 右 rail 表示", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		await page.getByRole("link", { name: "検索" }).click();
		await page.waitForURL("**/search");
		await expect(page.getByRole("heading", { name: "検索" })).toBeVisible();
		// 右 rail の panel header が見える
		await expect(page.getByText(/Trending tags/i)).toBeVisible();
		await expect(page.getByText(/Who to follow/i)).toBeVisible();
	});

	test("左 nav に「探索」 entry が存在しない", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		await expect(page.getByRole("link", { name: "探索" })).toHaveCount(0);
	});

	test("/explore 直叩きは 200 (route 維持)", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/explore");
		await expect(page.getByText(/トレンド|探索/)).toBeVisible({
			timeout: 10_000,
		});
		// 右 rail も同じ chrome で出る
		await expect(page.getByText(/Trending tags/i)).toBeVisible();
	});

	test("Mobile 375 で /search は中央のみ (rail 非表示)", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/search");
		await expect(page.getByRole("heading", { name: "検索" })).toBeVisible();
		// `aside[aria-label="右サイドバー"]` は `lg:block` なので 375 では DOM 上は
		// あっても非表示 (display:none)。 visible 判定で false になるべき。
		const rail = page.locator('aside[aria-label="右サイドバー"]');
		await expect(rail).toHaveCount(1);
		await expect(rail).not.toBeVisible();
	});
});
```

### 5.3 stg 実行コマンド

```bash
cd /workspace/client
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
  npx playwright test e2e/search-nav-rail.spec.ts --reporter=line
```

未ログインでも動くので credential 不要。

### 5.4 ui-ux-tester 事後監査

PR マージ + stg 反映後、 `ui-ux-tester` を呼んで:

- ホーム → 「検索」 が 1 click で /search に着地
- /search と /explore の chrome (右 rail 含む) が同じ見た目
- 375px で rail が出ない (regression なし)

### 5.5 gan-evaluator

nav 入口変更 + 大きな chrome 変化なので必須。 採点項目:

- 「検索」 entry がホームから 1 click 以内
- 未ログインで /search / /explore が壊れない
- 右 rail の content (Trending / Who to follow) が読める

## 6. 受け入れ基準

- [ ] 左 nav の label / path が変わっている
- [ ] /search で右 rail が見える (1280px)
- [ ] /search で中央が rail と被って読みづらくない (3.4 視認 OK)
- [ ] /explore 直叩きは引き続き 200
- [ ] Mobile 375 で /search が rail 非表示で動く
- [ ] vitest pass / Playwright spec pass
- [ ] reviewer 直列 (typescript / code / a11y / ui-ux) 全部 HIGH 以上なし
- [ ] gan-evaluator pass
- [ ] ROADMAP の該当行に check (もしあれば、 なければ無理に作らない)

## 7. ロールアウト / リスク

- リスク: SEO で /search / /explore が同等の content を indexing されると重複扱い
  - 緩和策: 本 Issue scope 外、 必要なら別 Issue で canonical / robots noindex 整理
- リスク: `/explore` への外部 link / bookmark は維持されるが、 nav からの導線が消えるので存在感が下がる
  - 緩和策: 別 Issue で /explore を 「discover hub」 として明示的にリッチ化する判断を別途検討
- リスク: `ARightRail` の幅 (320px) が中央 column を圧迫
  - 緩和策: 既存挙動 (`hidden lg:block`) のままで他 page (/`/` / `/articles` 等) と同じ behavior、 新規問題ない見込み
