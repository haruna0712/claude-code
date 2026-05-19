/**
 * #808 / search-nav-anon-gate
 *
 * - nav 「検索」 click → /search 着地 (#803 → #808 で逆転、 path /search 固定)
 * - /explore 直叩きは引き続き 200 (deep link 維持)
 * - anon + /search?q=django: chrome + 「検索はログインが必要です」 promo
 * - anon + /search (q なし): 「最新の投稿」 feed (現状維持)
 *
 * anonymous OK のため credential 不要。
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/search-nav-anon-gate.spec.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

test.describe("Search nav back to /search + anon query gate (#808)", () => {
	test("desktop 1280: nav 「検索」 click → /search に着地 (/explore でなく)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");

		const searchLink = page.getByRole("link", { name: "検索", exact: true });
		await expect(searchLink).toBeVisible({ timeout: 15_000 });
		await searchLink.click();
		await page.waitForURL("**/search");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible();
	});

	test("/explore 直叩きは引き続き 200 (deep link 維持、 chrome は /search と共有)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const response = await page.goto("/explore");
		expect(response?.status() ?? 0).toBeLessThan(400);
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("anon + /search?q=django: 「検索はログインが必要です」 promo 表示", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto("/search?q=django");
			// chrome は visible
			await expect(
				page.getByRole("heading", { name: "検索", level: 1 }),
			).toBeVisible({ timeout: 15_000 });
			// promo h2 + button
			await expect(
				page.getByRole("heading", {
					name: "検索はログインが必要です",
					level: 2,
				}),
			).toBeVisible();
			await expect(page.getByRole("link", { name: "ログイン" })).toBeVisible();
			await expect(page.getByRole("link", { name: "新規登録" })).toBeVisible();
			// 件数行 / 検索結果は出ない
			await expect(page.getByText(/「django」 — /)).toHaveCount(0);
		} finally {
			await ctx.close();
		}
	});

	test("anon + /search (q なし): 「最新の投稿」 feed 表示 (現状維持)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto("/search");
			await expect(
				page.getByRole("heading", { name: "最新の投稿", level: 2 }),
			).toBeVisible({ timeout: 15_000 });
			// promo は出ない (q なしのため)
			await expect(
				page.getByRole("heading", { name: "検索はログインが必要です" }),
			).toHaveCount(0);
		} finally {
			await ctx.close();
		}
	});
});
