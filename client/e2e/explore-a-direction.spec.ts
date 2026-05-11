/**
 * /explore A direction polish E2E (#584 Phase B-1-9).
 *
 * Spec: docs/specs/explore-a-direction-spec.md
 *
 * シナリオ:
 *   EXPLORE-A-1: 未ログインで /explore → sticky context bar + HeroBanner h1 + 単一 <main>
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/explore A direction polish (#584)", () => {
	test("EXPLORE-A-1: 未ログインで /explore → sticky bar + Hero + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/explore`);

		// sticky context bar に「Explore」
		await expect(page.getByText("Explore").first()).toBeVisible({
			timeout: 15000,
		});

		// HeroBanner の h1 が見える (「エンジニアによる」 を含む)
		await expect(
			page.getByRole("heading", { name: /エンジニアによる/, level: 1 }),
		).toBeVisible();

		// 「新規登録する」 + 「ログイン」 CTA
		await expect(
			page.getByRole("link", { name: "新規登録する" }),
		).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
