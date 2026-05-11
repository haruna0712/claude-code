/**
 * /tweet/[id] と /threads/[id] A direction polish E2E (#579 Phase B-1-7).
 *
 * Spec: docs/specs/conversation-a-direction-spec.md
 *
 * シナリオ:
 *   CONV-A-1: 未ログインで /tweet/<id> → sticky 「ツイート」 h1 + 単一 <main>
 *   CONV-A-2: 未ログインで /threads/<id> → sticky 戻る link + thread title h1 + 単一 <main>
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("conversation A direction polish (#579)", () => {
	test("CONV-A-1: 未ログインで /tweet/<id> → sticky 「ツイート」 h1 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		// Find a tweet id via /explore (lists public tweets)
		await page.goto(`${BASE}/explore`);
		const tweetLink = page.locator('a[href^="/tweet/"]').first();
		const count = await tweetLink.count();
		if (count === 0) {
			test.skip(true, "No public tweets on stg, skip /tweet/<id> test");
			return;
		}
		const href = await tweetLink.getAttribute("href");
		await page.goto(`${BASE}${href}`);

		await expect(
			page.getByRole("heading", { name: "ツイート", level: 1 }),
		).toBeVisible({ timeout: 15000 });

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});

	test("CONV-A-2: 未ログインで /threads/<id> → sticky 戻る link + h1 + 単一 <main>", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/boards`);
		const boardLink = page.locator('a[href^="/boards/"]').first();
		const boardCount = await boardLink.count();
		if (boardCount === 0) {
			test.skip(true, "No boards on stg, skip /threads/<id> test");
			return;
		}
		const boardHref = await boardLink.getAttribute("href");
		await page.goto(`${BASE}${boardHref}`);

		const threadLink = page.locator('a[href^="/threads/"]').first();
		const threadCount = await threadLink.count();
		if (threadCount === 0) {
			test.skip(true, "No threads on first board, skip");
			return;
		}
		const threadHref = await threadLink.getAttribute("href");
		await page.goto(`${BASE}${threadHref}`);

		// sticky header: back link (← <board>)
		await expect(page.locator("header a").first()).toBeVisible({
			timeout: 15000,
		});

		// thread title h1 が見える
		await expect(page.locator("h1").first()).toBeVisible();

		const mainCount = await page.locator("main").count();
		expect(mainCount).toBe(1);

		await ctx.close();
	});
});
