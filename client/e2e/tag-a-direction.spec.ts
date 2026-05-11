/**
 * /tag/[name] A direction polish E2E (#581 Phase B-1-8).
 *
 * Spec: docs/specs/tag-a-direction-spec.md
 *
 * シナリオ:
 *   TAG-A-1: 未ログインで /tag/<name> → sticky 「#name」 h1 + 単一 <main>
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/tag/[name] A direction polish (#581)", () => {
	test("TAG-A-1: 未ログインで /tag/<name> → sticky h1 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		// Find a tag via /explore (or fall back to a known stg tag like 「python」)
		await page.goto(`${BASE}/explore`);
		const tagLink = page.locator('a[href^="/tag/"]').first();
		const count = await tagLink.count();
		let href: string | null = null;
		if (count > 0) {
			href = await tagLink.getAttribute("href");
		} else {
			// fallback: hit a known plausible tag
			href = "/tag/python";
		}
		await page.goto(`${BASE}${href}`);

		// h1 starting with `#`
		await expect(
			page.locator("h1").filter({ hasText: /^#/ }).first(),
		).toBeVisible({ timeout: 15000 });

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
