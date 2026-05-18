/**
 * #741 IA refactor — /explore / 検索 nav / 右 sidebar Twitter 準拠 統合.
 *
 * Spec: docs/specs/explore-search-rightrail-spec.md
 *
 * 対象 3 軸:
 *   1. /explore を logged-in でも開ける (redirect 削除)、 最上部に SearchBox 常置
 *   2. 左 nav は「探索」 1 entry のみ (虫眼鏡 icon)、 「検索」 削除
 *   3. 右 rail は /search / /agent / /messages/<id> / /articles/<slug> で hide
 *      rail の search panel は削除、 dummy footer text 削除
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test4@example.com \
 *   PLAYWRIGHT_USER1_PASSWORD=E5INn9EaBLG7WNPl \
 *   PLAYWRIGHT_USER1_HANDLE=test4 \
 *     npx playwright test e2e/explore-search-rail.spec.ts --reporter=line
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "test4@example.com",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "E5INn9EaBLG7WNPl", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "test4",
};

async function loginViaApi(
	request: APIRequestContext,
	user: { email: string; password: string },
) {
	const csrfRes = await request.get(`${BASE}/api/v1/auth/csrf/`);
	expect(csrfRes.status()).toBeLessThan(400);
	const cookieHeader = csrfRes.headers()["set-cookie"] ?? "";
	const csrf = /csrftoken=([^;]+)/.exec(cookieHeader)?.[1] ?? "";
	const login = await request.post(`${BASE}/api/v1/auth/cookie/create/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/login`,
		},
		data: { email: user.email, password: user.password },
	});
	expect(login.status()).toBe(200);
}

// 右 rail は `<aside aria-label="右サイドバー">` で render される。
const RAIL_SELECTOR = 'aside[aria-label="右サイドバー"]';

test.describe("#741 /explore + search + right rail IA refactor", () => {
	// ───────────────────────────────────────────────── /explore (logged-in)

	test("EXP-1: /explore を logged-in で開く → redirect されず trending が出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/explore`);

		// redirect されない (URL が /explore のまま)
		expect(page.url()).toContain("/explore");

		// 最上部に SearchBox (form role=search) が常置
		await expect(
			page.getByRole("search", { name: /検索/ }).first(),
		).toBeVisible({ timeout: 15000 });

		// HeroBanner (anon 専用) は logged-in 時 非表示
		await expect(
			page.getByRole("heading", { name: /エンジニアによる/, level: 1 }),
		).toHaveCount(0);

		// StickyLoginBanner (anon 専用) は logged-in 時 非表示
		await expect(page.getByRole("link", { name: "新規登録する" })).toHaveCount(
			0,
		);

		await ctx.close();
	});

	test("EXP-2: /explore SearchBox に query 入力 → /search?q=... へ遷移", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/explore`);

		const searchBox = page.getByRole("search", { name: /検索/ }).first();
		await expect(searchBox).toBeVisible({ timeout: 15000 });
		await searchBox.getByRole("searchbox").fill("python");
		await searchBox.getByRole("button", { name: /検索/ }).click();

		await page.waitForURL(/\/search\?q=python/);
		expect(page.url()).toMatch(/\/search\?q=python$/);

		await ctx.close();
	});

	// ───────────────────────────────────────────────── /explore empty fallback (#746)

	test("EMPTY-1: trending 空のとき WhoToFollow が inline fallback として出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/explore`);

		// trending feed の現在の状態を判定 (stg は通常 empty だが populated でも
		// 正しく動くよう conditional assertion):
		//   - empty: 「今は表示できるツイートがありません。」 が見える
		//             → 中央 column 内に WhoToFollow の「おすすめユーザー」 h2 が
		//               (右 rail の同名 h2 とは独立に、 main 内で) 見える
		//   - populated: tweet card が複数 → 中央 column 内に WhoToFollow なし
		//     (右 rail には依然出るので 1 個は存在しうる、 main scope に限定して判定)
		const emptyMessage = page.getByText("今は表示できるツイートがありません。");
		const mainColumn = page.getByRole("main", { name: /メインコンテンツ/ });
		const fallbackHeading = mainColumn.getByRole("heading", {
			name: /^おすすめユーザー$/,
			level: 2,
		});

		await page
			.getByRole("heading", { name: /トレンドツイート/, level: 2 })
			.waitFor({ timeout: 15000 });

		if (await emptyMessage.isVisible()) {
			await expect(fallbackHeading).toBeVisible();
		} else {
			await expect(fallbackHeading).toHaveCount(0);
		}

		await ctx.close();
	});

	test("EMPTY-2: anon `/explore` でも空のときに WhoToFollow inline 出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/explore`);

		const emptyMessage = page.getByText("今は表示できるツイートがありません。");
		const mainColumn = page.getByRole("main", { name: /メインコンテンツ/ });
		const fallbackHeading = mainColumn.getByRole("heading", {
			name: /^おすすめユーザー$/,
			level: 2,
		});

		await page
			.getByRole("heading", { name: /トレンドツイート/, level: 2 })
			.waitFor({ timeout: 15000 });

		if (await emptyMessage.isVisible()) {
			await expect(fallbackHeading).toBeVisible();
		} else {
			await expect(fallbackHeading).toHaveCount(0);
		}

		await ctx.close();
	});

	// ───────────────────────────────────────────────── /explore (anon)

	test("EXP-3: /explore を logged-out で開く → Hero + Sticky + SearchBox", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/explore`);

		// HeroBanner h1 (anon 専用)
		await expect(
			page.getByRole("heading", { name: /エンジニアによる/, level: 1 }),
		).toBeVisible({ timeout: 15000 });

		// SearchBox も常置 (anon でも見える)
		await expect(
			page.getByRole("search", { name: /検索/ }).first(),
		).toBeVisible();

		await ctx.close();
	});

	// ───────────────────────────────────────────────── 左 nav

	test("NAV-1: 左 nav に「検索」 entry が存在しない", async ({ browser }) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/`);

		const nav = page.getByRole("complementary", {
			name: "メインナビゲーション",
		});
		await expect(nav).toBeVisible({ timeout: 15000 });

		// 「探索」 は存在する
		await expect(nav.getByRole("link", { name: "探索" })).toBeVisible();

		// 「検索」 entry は削除済 → 0 件
		await expect(nav.getByRole("link", { name: /^検索$/ })).toHaveCount(0);

		await ctx.close();
	});

	test("NAV-2: 左 nav の「探索」 click → /explore に遷移 (redirect なし)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.goto(`${BASE}/notifications`);

		const nav = page.getByRole("complementary", {
			name: "メインナビゲーション",
		});
		await nav.getByRole("link", { name: "探索" }).click();
		await page.waitForURL(/\/explore$/);
		expect(page.url()).toMatch(/\/explore$/);

		await ctx.close();
	});

	// ───────────────────────────────────────────────── 右 rail 非表示 group

	test("RAIL-HIDE-1: /search で右 rail 非表示", async ({ browser }) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/search`);

		// rail は lg+ で表示される設計、 1280px viewport で本来出るはずだが #741 で hide 対象
		await expect(page.locator(RAIL_SELECTOR)).toHaveCount(0);

		await ctx.close();
	});

	test("RAIL-HIDE-2: /agent で右 rail 非表示", async ({ browser }) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/agent`);

		await expect(page.locator(RAIL_SELECTOR)).toHaveCount(0);

		await ctx.close();
	});

	test("RAIL-HIDE-3: /articles/<slug> で右 rail 非表示", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		// audit で存在を確認した stg の slug
		await page.goto(`${BASE}/articles/phase6-stg-check`);

		await expect(page.locator(RAIL_SELECTOR)).toHaveCount(0);

		await ctx.close();
	});

	// ───────────────────────────────────────────────── 右 rail 表示 group

	test("RAIL-SHOW-1: / (home) で右 rail 表示、 search panel は削除済", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/`);

		const rail = page.locator(RAIL_SELECTOR);
		await expect(rail).toBeVisible({ timeout: 15000 });

		// trending tags panel
		await expect(rail.getByText(/Trending tags/i)).toBeVisible();
		// who-to-follow panel
		await expect(rail.getByText(/Who to follow/i)).toBeVisible();

		// search panel (`/search` への <a>) は削除済
		await expect(rail.locator('a[href="/search"]')).toHaveCount(0);

		await ctx.close();
	});

	test("RAIL-SHOW-2: /notifications で右 rail 表示 (browse 系維持)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/notifications`);

		await expect(page.locator(RAIL_SELECTOR)).toBeVisible({ timeout: 15000 });

		await ctx.close();
	});

	test("RAIL-HIDE-4 (#756): /messages list で右 rail 非表示 (X 2-pane 準拠)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/messages`);

		// #756: X 準拠で /messages 全体 (list + thread + invitations) を hide。
		await expect(page.locator(RAIL_SELECTOR)).toHaveCount(0);

		await ctx.close();
	});

	// ───────────────────────────────────────────────── rail footer dummy 削除

	test("RAIL-FOOTER: 右 rail の dummy footer text が DOM に存在しない", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await loginViaApi(ctx.request, USER1);
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.goto(`${BASE}/`);

		const rail = page.locator(RAIL_SELECTOR);
		await expect(rail).toBeVisible({ timeout: 15000 });

		// about/pricing/changelog のいずれも rail 内に存在しない
		await expect(rail.getByText(/about/i)).toHaveCount(0);
		await expect(rail.getByText(/pricing/i)).toHaveCount(0);
		await expect(rail.getByText(/changelog/i)).toHaveCount(0);

		await ctx.close();
	});
});
