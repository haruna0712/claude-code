/**
 * Phase 12 P12-03 onboarding 居住地 step E2E.
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §7.6
 *
 * 検証シナリオ:
 *   ONBOARD-RES-1 (anon): /onboarding/residence を anon で踏んでも認証エラーで
 *                落ちず、 prompt が見える (page 自体は public、 link 先で auth gate)
 *   ONBOARD-RES-2 (golden): /onboarding/residence を踏む → 「あとで設定する」
 *                を click → / に遷移
 *   ONBOARD-RES-3 (set now): /onboarding/residence → 「今すぐ設定する」 →
 *                /settings/residence に遷移して「保存する」 button が見える
 *                (要 auth、 anon は /login に redirect される)
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
};

function requireEnv() {
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
	})) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

async function loginViaApi(
	request: APIRequestContext,
	user: { email: string; password: string },
): Promise<void> {
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

test.describe("Phase 12 P12-03 onboarding residence (#675)", () => {
	test("ONBOARD-RES-1: anon で /onboarding/residence は public で見える", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/onboarding/residence`);
		await expect(
			page.getByRole("heading", { name: /住んでる場所を設定しますか/ }),
		).toBeVisible({ timeout: 15000 });
		await ctx.close();
	});

	test("ONBOARD-RES-2: skip ボタンで / に遷移", async ({ browser }) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/onboarding/residence`);
		await page.getByRole("link", { name: /あとで設定する/ }).click();
		await page.waitForURL(`${BASE}/`, { timeout: 15000 });
		await ctx.close();
	});

	test("ONBOARD-RES-3: 今すぐ → /settings/residence で保存ボタンが見える", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		await loginViaApi(ctx.request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/onboarding/residence`);
		await page.getByRole("link", { name: /今すぐ設定する/ }).click();
		await page.waitForURL(`${BASE}/settings/residence`, { timeout: 15000 });
		await expect(page.getByRole("button", { name: "保存する" })).toBeVisible({
			timeout: 15000,
		});
		await ctx.close();
	});
});
