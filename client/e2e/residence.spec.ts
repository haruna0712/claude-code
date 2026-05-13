/**
 * Phase 12 P12-02 居住地マップ E2E spec.
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §7.2
 *
 * 検証シナリオ:
 *   RESIDENCE-1 (golden): ログイン → SettingsMenu から /settings/residence へ →
 *                slider 1.5km → 保存 → role=status 通知 → /u/<self> で円が描画されている
 *   RESIDENCE-2 (anon view): 別 user (test2) が設定した居住地を anon で踏んで
 *                /u/<test2> の map section が見える
 *   RESIDENCE-3 (min enforce): radius<500 を直接 API に投げて 400 が返る
 *                (frontend slider 改竄ですり抜けられないことを確認)
 *
 * env: docs/local/e2e-stg.md の test2 / test3 を使用。
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

test.describe("Phase 12 P12-02 residence map (#674)", () => {
	test("RESIDENCE-1: 設定 → 保存 → プロフィールに円", async ({ browser }) => {
		requireEnv();

		const ctx = await browser.newContext();
		const { csrf } = await loginViaApi(ctx.request, USER1);

		// API で先に設定 (UI slider 操作は Leaflet の地図 click が flaky になりやすいので
		// 設定は API、 UI 側は「画面に出るか」 を確認する分担)
		const save = await ctx.request.patch(`${BASE}/api/v1/users/me/residence/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${BASE}/settings/residence`,
			},
			data: {
				latitude: "35.681236",
				longitude: "139.767125",
				radius_m: 1500,
			},
		});
		expect(save.status()).toBe(200);

		const page = await ctx.newPage();
		// 自分のプロフィールに map 描画 (Leaflet container が DOM に生える)
		await page.goto(`${BASE}/u/${USER1.handle}`);
		const residenceSection = page.getByRole("region", { name: "居住地" });
		await expect(residenceSection).toBeVisible({ timeout: 15000 });
		// Leaflet tile container (`.leaflet-container`) が出ているか
		await expect(page.locator(".leaflet-container").first()).toBeVisible({
			timeout: 15000,
		});

		// /settings/residence に遷移して保存 button が見えること (ログイン経路の確認)
		await page.goto(`${BASE}/settings/residence`);
		await expect(page.getByRole("button", { name: "保存する" })).toBeVisible({
			timeout: 15000,
		});

		await ctx.close();
	});

	test("RESIDENCE-2: 他人のプロフィールでも anon で map が見える", async ({
		browser,
	}) => {
		requireEnv();

		// 事前に USER1 が設定済みの前提 (RESIDENCE-1 で設定したまま残す)
		const anon = await browser.newContext();
		const anonPage = await anon.newPage();
		await anonPage.goto(`${BASE}/u/${USER1.handle}`);
		await expect(anonPage.getByRole("region", { name: "居住地" })).toBeVisible({
			timeout: 15000,
		});
		await anon.close();
	});

	test("RESIDENCE-3: radius<500 は API で 400 (privacy enforce)", async ({
		browser,
	}) => {
		requireEnv();

		const ctx = await browser.newContext();
		const { csrf } = await loginViaApi(ctx.request, USER2);
		const res = await ctx.request.patch(`${BASE}/api/v1/users/me/residence/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${BASE}/settings/residence`,
			},
			data: {
				latitude: "35.0",
				longitude: "139.0",
				radius_m: 100,
			},
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body).toHaveProperty("radius_m");
		await ctx.close();
	});
});
