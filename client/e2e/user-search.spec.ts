/**
 * Phase 12 P12-04 ユーザー検索 E2E spec.
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §7.4
 *
 * 検証シナリオ:
 *   USER-SEARCH-1 (anon): /search/users に anon で踏んで search 200
 *   USER-SEARCH-2 (golden): test2 handle で検索 → 自分の handle カードが結果に出る →
 *                クリック → /u/<test2> プロフィール
 *   USER-SEARCH-3 (nav): home からナビ「ユーザー検索」 click で 1 click 到達
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

function requireHandle() {
	if (!USER1.handle) {
		throw new Error("PLAYWRIGHT_USER1_HANDLE is not set");
	}
}

test.describe("Phase 12 P12-04 user search (#676)", () => {
	test("USER-SEARCH-1: anon で /search/users が 200 で表示される", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/search/users`);
		await expect(
			page.getByRole("heading", { name: "ユーザー検索" }),
		).toBeVisible({ timeout: 15000 });
		await expect(
			page.getByRole("search", { name: "ユーザー検索" }),
		).toBeVisible();
		await ctx.close();
	});

	test("USER-SEARCH-2: 検索 → user card → プロフィール", async ({
		browser,
	}) => {
		requireHandle();
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(
			`${BASE}/search/users?q=${encodeURIComponent(USER1.handle)}`,
		);
		// 該当 handle のカード (link to /u/<handle>) が見える
		const card = page.getByRole("link", {
			name: new RegExp(`@${USER1.handle}\\b`),
		});
		await expect(card.first()).toBeVisible({ timeout: 15000 });
		await card.first().click();
		await page.waitForURL(new RegExp(`/u/${USER1.handle}(\\?|$)`), {
			timeout: 15000,
		});
		await ctx.close();
	});

	test("USER-SEARCH-3: home から 1 click でユーザー検索に到達", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/`);
		const link = page.getByRole("link", { name: "ユーザー検索" }).first();
		await expect(link).toBeVisible({ timeout: 15000 });
		await link.click();
		await page.waitForURL(/\/search\/users(\?|$)/, { timeout: 15000 });
		await ctx.close();
	});
});
