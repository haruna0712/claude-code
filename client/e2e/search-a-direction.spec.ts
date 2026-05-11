/**
 * /search A direction polish E2E (#586 Phase B-1-10).
 *
 * シナリオ:
 *   SEARCH-A-1: /search → sticky 「検索」 h1 + 単一 <main>
 *   SEARCH-A-2: /search?q=test → 「test」 subtitle + 結果 section
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/search A direction polish (#586)", () => {
	test("SEARCH-A-1: /search (no query) → sticky 「検索」 h1 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/search`);

		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("SEARCH-A-2: /search?q=test → query subtitle + 結果 section が出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/search?q=test`);

		// h1 「検索」
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 検索結果 section
		await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible();

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
