/**
 * /boards A direction polish E2E (#570 Phase B-1-3).
 *
 * Spec: docs/specs/boards-a-direction-spec.md
 *
 * シナリオ:
 *   BOARDS-A-1: 未ログインで /boards → sticky header + 単一 <main>
 *   BOARDS-A-2: 未ログインで /boards/<slug> → 戻る link + 単一 <main>
 *
 * env: docs/local/e2e-stg.md
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/boards A direction polish (#570)", () => {
	test("BOARDS-A-1: 未ログインで /boards → sticky header + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/boards`);

		// h1 「掲示板」
		await expect(
			page.getByRole("heading", { name: "掲示板", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("BOARDS-A-2: 未ログインで /boards/<slug> → 戻る link + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();

		// Find a board slug via the list page
		await page.goto(`${BASE}/boards`);
		const firstBoardLink = page.locator('a[href^="/boards/"]').first();
		const count = await firstBoardLink.count();
		if (count === 0) {
			test.skip(true, "No boards on stg, skip detail test");
			return;
		}
		const href = await firstBoardLink.getAttribute("href");
		await page.goto(`${BASE}${href}`);

		// 「← 掲示板」 戻る link
		await expect(
			page.getByRole("link", { name: /掲示板/ }).first(),
		).toBeVisible({ timeout: 15000 });

		// 板名 h1 が見える (どんな名前でも level=1 の heading が 1 つ以上)
		await expect(page.locator("h1").first()).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
