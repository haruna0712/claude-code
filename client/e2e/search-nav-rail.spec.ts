/**
 * #795 / search-nav-rename-rail
 *
 * 左 nav 「探索」 → 「検索」 + path /search に変更、 /search で右 rail を表示
 * (ARightRail = TrendingTags + WhoToFollow)、 /explore route は維持。
 *
 * Login helper は #797 で共通化予定 (stg は日本語 UI で /メールアドレス/、 local
 * docker fixture は英語 UI のため regex で両対応)。
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/search-nav-rail.spec.ts --reporter=line
 *
 * 認証は anonymous OK の項目だけ用意してあるので credential 不要。
 */

import { expect, test } from "@playwright/test";

test.describe("Search nav rename + right rail (#795)", () => {
	test("desktop 1280: 左 nav 「検索」 click → /search 着地 + 右 rail 表示", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");

		const searchLink = page.getByRole("link", { name: "検索", exact: true });
		await expect(searchLink).toBeVisible({ timeout: 15_000 });
		await searchLink.click();
		await page.waitForURL("**/search");

		// /search ページの heading
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible();

		// 右 rail (ARightRail) の 2 panel が見える
		const rail = page.getByRole("complementary", { name: "右サイドバー" });
		await expect(rail).toBeVisible();
		await expect(rail.getByText(/Trending tags/i)).toBeVisible();
		await expect(rail.getByText(/Who to follow/i)).toBeVisible();
	});

	test("desktop 1280: 左 nav に 「探索」 entry が存在しない (regression)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto("/");
		await expect(
			page.getByRole("link", { name: "探索", exact: true }),
		).toHaveCount(0);
	});

	test("desktop 1280: /explore 直叩きは 200 (route 維持)", async ({ page }) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		const response = await page.goto("/explore");
		expect(response?.status() ?? 0).toBeLessThan(400);
		// /explore も同じ右 rail chrome を持っている
		await expect(
			page.getByRole("complementary", { name: "右サイドバー" }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("mobile 375: /search の右 rail は非表示 (lg:block のため)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto("/search");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });

		// rail は DOM 上は存在するが visible は false (display:none via lg:block)
		const rail = page.getByRole("complementary", { name: "右サイドバー" });
		await expect(rail).not.toBeVisible();
	});

	test("anonymous でも /search 200 + 右 rail 表示", async ({ browser }) => {
		// fresh context (cookie / auth なし)。 baseURL は playwright.config 経由で
		// 解決 (PLAYWRIGHT_BASE_URL 未設定時のデフォルト分岐を 1 箇所に集約)。
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			const response = await page.goto("/search");
			expect(response?.status() ?? 0).toBeLessThan(400);
			await expect(
				page.getByRole("heading", { name: "検索", level: 1 }),
			).toBeVisible({ timeout: 15_000 });
			await expect(
				page.getByRole("complementary", { name: "右サイドバー" }),
			).toBeVisible();
		} finally {
			await ctx.close();
		}
	});
});
