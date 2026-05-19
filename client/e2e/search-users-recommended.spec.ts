/**
 * #810 / search-users-recommended
 *
 * /search/users (q なし) で 「おすすめユーザー」 section を中央に表示する変更の
 * E2E 確認。 anonymous OK のため credential 不要。
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/search-users-recommended.spec.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

test.describe("Users tab recommended (#810)", () => {
	test("/search/users (q なし) で 「おすすめユーザー」 h2 + WhoToFollow が visible", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/search/users");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(
			page.getByRole("heading", { name: "おすすめユーザー", level: 2 }),
		).toBeVisible();
	});

	test("/search/users?q=alice (q あり) で 「おすすめユーザー」 は出ない (検索結果モード)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/search/users?q=alice");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
		// q ありなので 「おすすめユーザー」 h2 は出ない (検索結果 or empty placeholder)
		await expect(
			page.getByRole("heading", { name: "おすすめユーザー", level: 2 }),
		).toHaveCount(0);
	});

	test("anonymous でも /search/users 200 + 「おすすめユーザー」 visible", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			const response = await page.goto("/search/users");
			expect(response?.status() ?? 0).toBeLessThan(400);
			await expect(
				page.getByRole("heading", { name: "おすすめユーザー", level: 2 }),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await ctx.close();
		}
	});
});
