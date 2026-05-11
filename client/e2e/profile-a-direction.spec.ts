/**
 * /u/[handle] A direction polish E2E (#568 Phase B-1-2).
 *
 * Spec: docs/specs/profile-a-direction-spec.md
 *
 * シナリオ:
 *   PROFILE-A-1: 未ログインで /u/test2 → sticky header + 単一 <main> + tabs
 *   PROFILE-A-2: 未ログインで /u/test2/followers → 戻る link + 「フォロワー」 + 単一 <main>
 *   PROFILE-A-3: 未ログインで /u/test2/following → 戻る link + 「フォロー中」 + 単一 <main>
 *
 * env: docs/local/e2e-stg.md の test2 を使用。
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const HANDLE = process.env.PLAYWRIGHT_USER1_HANDLE ?? "test2";

test.describe("/u/[handle] A direction polish (#568)", () => {
	test("PROFILE-A-1: 未ログインで /u/<handle> → sticky header + 単一 <main> + tabs", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/u/${HANDLE}`);

		// sticky header: display_name or username が h1
		await expect(page.locator("h1").first()).toBeVisible({ timeout: 15000 });

		// @handle がどこかに見える (sticky header または stats)
		await expect(page.getByText(`@${HANDLE}`).first()).toBeVisible();

		// tabs (ポスト / いいね)
		await expect(page.getByRole("link", { name: "ポスト" })).toBeVisible();
		await expect(page.getByRole("link", { name: "いいね" })).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("PROFILE-A-2: 未ログインで /u/<handle>/followers → 戻る link + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/u/${HANDLE}/followers`);

		// 戻る link
		await expect(
			page.getByRole("link", { name: new RegExp(`@${HANDLE}`) }),
		).toBeVisible({ timeout: 15000 });

		// 「フォロワー」 heading
		await expect(
			page.getByRole("heading", { name: "フォロワー", level: 1 }),
		).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("PROFILE-A-3: 未ログインで /u/<handle>/following → 戻る link + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/u/${HANDLE}/following`);

		// 戻る link
		await expect(
			page.getByRole("link", { name: new RegExp(`@${HANDLE}`) }),
		).toBeVisible({ timeout: 15000 });

		// 「フォロー中」 heading
		await expect(
			page.getByRole("heading", { name: "フォロー中", level: 1 }),
		).toBeVisible();

		// 単一 <main>
		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
