/**
 * Phase 12 P12-05 近所検索 E2E spec.
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §7.5
 *
 * 検証シナリオ:
 *   NEAR-1 (anon hint): /search/users?near_me=1 を anon で踏むと「ログインが必要」 が出る
 *   NEAR-2 (no-residence hint): 居住地未設定で near_me=1 を踏むと「/settings/residence で設定」 link
 *   NEAR-3 (golden): test2 が居住地を設定 → ?near_me=1&radius_km=20 で
 *                自分以外の near user カードに「約 X km」 バッジが出る
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};
const USER2 = {
	email: process.env.PLAYWRIGHT_USER2_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER2_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER2_HANDLE ?? "",
};

function requireEnv() {
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	})) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

async function loginViaApi(
	request: APIRequestContext,
	user: { email: string; password: string },
): Promise<{ csrf: string }> {
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
	return { csrf };
}

test.describe("Phase 12 P12-05 near-me search (#677)", () => {
	test("NEAR-1: anon で /search/users?near_me=1 にログイン誘導が出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/search/users?near_me=1&radius_km=10`);
		await expect(page.getByText(/ログインが必要/)).toBeVisible({
			timeout: 15000,
		});
		await ctx.close();
	});

	test("NEAR-3: 設定済 user の near_me=1 で 近所の人が距離バッジ付きで出る", async ({
		browser,
	}) => {
		requireEnv();

		// USER2 を test 用に東京駅にプロット
		const ctx2 = await browser.newContext();
		const { csrf: csrf2 } = await loginViaApi(ctx2.request, USER2);
		await ctx2.request.patch(`${BASE}/api/v1/users/me/residence/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf2,
				Referer: `${BASE}/settings/residence`,
			},
			data: {
				latitude: "35.681236",
				longitude: "139.767125",
				radius_m: 1000,
			},
		});

		// USER1 も同じく近い場所 (新宿) にプロット
		const ctx1 = await browser.newContext();
		const { csrf: csrf1 } = await loginViaApi(ctx1.request, USER1);
		await ctx1.request.patch(`${BASE}/api/v1/users/me/residence/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf1,
				Referer: `${BASE}/settings/residence`,
			},
			data: {
				latitude: "35.689634",
				longitude: "139.700565",
				radius_m: 1000,
			},
		});

		// USER1 (= 新宿) で near_me=1 → USER2 (= 東京駅) の card が出る + 距離バッジ
		const page = await ctx1.newPage();
		await page.goto(`${BASE}/search/users?near_me=1&radius_km=20`);

		// USER2 card に約 X km バッジ
		const card = page.getByRole("link", {
			name: new RegExp(`@${USER2.handle}\\b`),
		});
		await expect(card.first()).toBeVisible({ timeout: 15000 });
		// 距離バッジ (約 X.YZ km) が card 内に出る
		await expect(page.getByText(/約 \d+(\.\d+)?\s*km/).first()).toBeVisible({
			timeout: 10000,
		});

		await ctx1.close();
		await ctx2.close();
	});

	test("NEAR-NAV: home からナビ「ユーザー検索」 → 近所 toggle が見える", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		await loginViaApi(ctx.request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/`);
		const link = page.getByRole("link", { name: "ユーザー検索" }).first();
		await link.click();
		await page.waitForURL(/\/search\/users(\?|$)/, { timeout: 15000 });
		await expect(
			page.getByRole("checkbox", { name: "自分の近所で絞り込む" }),
		).toBeVisible({ timeout: 15000 });
		await ctx.close();
	});
});
