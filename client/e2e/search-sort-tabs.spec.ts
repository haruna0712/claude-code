/**
 * #811 / search-sort-tabs
 *
 * /search?q=... に 「最新 / 注目」 tab を追加。 click で URL `?sort=top` が
 * 変わり、 backend の order が popularity_score DESC に切り替わる。
 *
 * 実行 (stg、 logged-in 必須なので credentials が要る):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test4@example.com \
 *   PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
 *     npx playwright test e2e/search-sort-tabs.spec.ts --reporter=line
 */

import { expect, test, type Page } from "@playwright/test";

const USER1_EMAIL = process.env.PLAYWRIGHT_USER1_EMAIL ?? "";
const USER1_PASSWORD = process.env.PLAYWRIGHT_USER1_PASSWORD ?? "";

const CREDENTIALS_PRESENT = Boolean(USER1_EMAIL && USER1_PASSWORD);

async function login(page: Page, email: string, password: string) {
	await page.goto("/login");
	// stg は日本語 UI、 local docker fixture は英語 UI で両対応 (#797 で共通化予定)。
	await page.getByLabel(/メールアドレス|Email Address/i).fill(email);
	await page.getByPlaceholder(/パスワード|Password/i).fill(password);
	await page.getByRole("button", { name: /ログイン|Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Search sort tabs (#811)", () => {
	test.skip(
		!CREDENTIALS_PRESENT,
		"PLAYWRIGHT_USER1_EMAIL / PASSWORD が必要 (docs/local/e2e-stg.md)",
	);

	test("logged-in /search?q=django で 「最新」 / 「注目」 tab が表示される", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/search?q=django");

		const tablist = page.getByRole("tablist", { name: "検索結果の並び替え" });
		await expect(tablist).toBeVisible({ timeout: 15_000 });
		// 「最新」 は default で aria-selected=true
		const latestTab = page.getByRole("tab", { name: "最新" });
		const topTab = page.getByRole("tab", { name: "注目" });
		await expect(latestTab).toHaveAttribute("aria-selected", "true");
		await expect(topTab).toHaveAttribute("aria-selected", "false");
	});

	test("「注目」 タブ click で URL が ?sort=top に変わり、 aria-selected が反転", async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 800 });
		await login(page, USER1_EMAIL, USER1_PASSWORD);
		await page.goto("/search?q=django");

		await page.getByRole("tab", { name: "注目" }).click();
		await page.waitForURL(/\/search\?q=django.*sort=top/);

		// 反転後の aria-selected
		await expect(page.getByRole("tab", { name: "注目" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await expect(page.getByRole("tab", { name: "最新" })).toHaveAttribute(
			"aria-selected",
			"false",
		);
	});

	test("anon /search?q=django では sort tab は出ない (promo が表示)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		try {
			await page.setViewportSize({ width: 1280, height: 800 });
			await page.goto("/search?q=django");
			await expect(
				page.getByRole("heading", { name: "検索はログインが必要です" }),
			).toBeVisible({ timeout: 15_000 });
			// sort tab は q ありかつ logged-in でしか出ない
			await expect(
				page.getByRole("tablist", { name: "検索結果の並び替え" }),
			).toHaveCount(0);
		} finally {
			await ctx.close();
		}
	});
});
