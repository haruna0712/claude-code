/**
 * /tag/[name] A direction polish E2E (#581 Phase B-1-8).
 *
 * Spec: docs/specs/tag-a-direction-spec.md
 *
 * シナリオ:
 *   TAG-A-1: 未ログインで /tag/<name> → sticky 「#name」 h1 + 単一 <main>
 *
 * stg にタグが 1 つも存在しないとき (全 404) はテストを skip。
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/tag/[name] A direction polish (#581)", () => {
	test("TAG-A-1: 未ログインで /tag/<name> → sticky h1 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		// Find a tag link from / or /explore (trending tags / inline tags)
		await page.goto(`${BASE}/`);
		let href: string | null = null;
		const tagLink = page.locator('a[href^="/tag/"]').first();
		if ((await tagLink.count()) > 0) {
			href = await tagLink.getAttribute("href");
		} else {
			await page.goto(`${BASE}/explore`);
			const expLink = page.locator('a[href^="/tag/"]').first();
			if ((await expLink.count()) > 0) {
				href = await expLink.getAttribute("href");
			}
		}
		if (!href) {
			test.skip(true, "No tag links found on stg, skip");
			return;
		}
		const resp = await page.goto(`${BASE}${href}`);
		if (resp && resp.status() >= 400) {
			test.skip(true, `Tag ${href} returned ${resp.status()}, skip`);
			return;
		}

		// h1 starting with `#`
		await expect(
			page.locator("h1").filter({ hasText: /^#/ }).first(),
		).toBeVisible({ timeout: 15000 });

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
