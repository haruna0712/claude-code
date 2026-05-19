/**
 * #806 / explore-search-chrome-unify
 *
 * /explore と /search の chrome (投稿リスト以外) が完全に一致することを assert。
 * q なし → 「最新の投稿」 / q あり → 検索結果、 で content だけ切り替わる。
 *
 * 実行 (stg、 anonymous OK):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/explore-search-chrome-unify.spec.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

test.describe("Explore / Search chrome unification (#806)", () => {
	test("両 URL で h1 「検索」 / tabs / 説明文 / SearchBox が visible", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		// /explore
		await page.goto("/explore");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("tab", { name: /投稿/ })).toBeVisible();
		await expect(page.getByRole("tab", { name: /ユーザー/ })).toBeVisible();
		await expect(
			page.getByText(/投稿本文、タグ、投稿者で検索します/),
		).toBeVisible();
		await expect(page.getByRole("searchbox").first()).toBeVisible();

		// /search (q なし) — 同じ chrome
		await page.goto("/search");
		await expect(
			page.getByRole("heading", { name: "検索", level: 1 }),
		).toBeVisible({ timeout: 15_000 });
		await expect(page.getByRole("tab", { name: /投稿/ })).toBeVisible();
		await expect(page.getByRole("tab", { name: /ユーザー/ })).toBeVisible();
		await expect(
			page.getByText(/投稿本文、タグ、投稿者で検索します/),
		).toBeVisible();
		await expect(page.getByRole("searchbox").first()).toBeVisible();
	});

	test("q なし: /explore /search 両方とも 「最新の投稿」 h2 が visible", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		await page.goto("/explore");
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toBeVisible({ timeout: 15_000 });

		await page.goto("/search");
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toBeVisible({ timeout: 15_000 });
	});

	test("q あり: /explore /search 両方とも 「『q』 — N 件」 + 検索結果 (h2 「最新の投稿」 は出ない)", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });

		await page.goto("/explore?q=django");
		await expect(page.getByText(/「django」 .* 件/)).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toHaveCount(0);

		await page.goto("/search?q=django");
		await expect(page.getByText(/「django」 .* 件/)).toBeVisible({
			timeout: 15_000,
		});
		await expect(
			page.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toHaveCount(0);
	});

	test("anonymous でも /explore /search 両方 200 + chrome 表示", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });

			let resp = await page.goto("/explore");
			expect(resp?.status() ?? 0).toBeLessThan(400);
			await expect(
				page.getByRole("heading", { name: "検索", level: 1 }),
			).toBeVisible({ timeout: 15_000 });

			resp = await page.goto("/search");
			expect(resp?.status() ?? 0).toBeLessThan(400);
			await expect(
				page.getByRole("heading", { name: "検索", level: 1 }),
			).toBeVisible({ timeout: 15_000 });
		} finally {
			await ctx.close();
		}
	});
});
