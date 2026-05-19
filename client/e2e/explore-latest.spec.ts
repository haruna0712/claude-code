/**
 * #803 / explore-latest
 *
 * 左 nav 「検索」 アイコン click → /explore 着地、 中央 column が SearchBox +
 * 「最新の投稿」 feed の 2 段構成、 右 rail (ARightRail) も同時表示。
 *
 * シナリオ (anonymous OK のため credential 不要):
 *   1. desktop 1280: 左 nav 「検索」 → /explore 着地 + h2 「最新の投稿」 visible
 *   2. /explore に SearchBox が表示される (submit すると /search に遷移)
 *   3. 右 rail (TrendingTags + WhoToFollow) が表示される
 *   4. mobile 375: 中央 column のみ、 right rail 非表示
 *   5. /search は別 page として残り、 q クエリで検索結果表示 (regression)
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/explore-latest.spec.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

test.describe("Explore latest feed (#803)", () => {
	test("desktop 1280: 左 nav 「検索」 → /explore + 「最新の投稿」 + 右 rail", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");

		const searchLink = page.getByRole("link", { name: "検索", exact: true });
		await expect(searchLink).toBeVisible({ timeout: 15_000 });
		await searchLink.click();
		await page.waitForURL("**/explore");

		// h2 「最新の投稿」 が見える
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toBeVisible();

		// 右 rail (ARightRail) の panel が見える
		const rail = page.getByRole("complementary", { name: "右サイドバー" });
		await expect(rail).toBeVisible();
		await expect(rail.getByText(/Trending tags/i)).toBeVisible();
	});

	test("/explore に SearchBox が表示され、 submit で /search に遷移", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/explore");

		// SearchBox の入力欄が見える
		const searchInput = page.getByRole("searchbox").first();
		await expect(searchInput).toBeVisible({ timeout: 15_000 });

		// 適当なキーワードで submit → /search?q=... に遷移
		await searchInput.fill("django");
		await searchInput.press("Enter");
		await page.waitForURL(/\/search\?q=django/);
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible();
	});

	test("mobile 375: /explore は中央のみ表示、 右 rail 非表示", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/explore");

		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toBeVisible({ timeout: 15_000 });

		const rail = page.getByRole("complementary", { name: "右サイドバー" });
		await expect(rail).not.toBeVisible();
	});

	test("anonymous でも /explore 200 + 最新の投稿 visible", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			const response = await page.goto("/explore");
			expect(response?.status() ?? 0).toBeLessThan(400);
			await expect(
				page.getByRole("heading", { name: "最新の投稿", level: 2 }),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await ctx.close();
		}
	});

	test("/search は別 page として残る (regression、 q クエリで結果表示)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/search?q=django");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
		// /search は 「最新の投稿」 h2 を持たない (現状維持)
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toHaveCount(0);
	});
});
