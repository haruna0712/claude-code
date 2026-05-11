/**
 * /settings A direction polish E2E (#577 Phase B-1-6).
 *
 * Spec: docs/specs/settings-a-direction-spec.md
 *
 * シナリオ:
 *   SETTINGS-A-1: /settings/profile → 「プロフィール編集」 h1 + 単一 <main>
 *   SETTINGS-A-2: /settings/notifications → 「通知の設定」 h1 + 単一 <main>
 *   SETTINGS-A-3: /settings/blocks → 「ブロック中のユーザー」 h1 + 単一 <main>
 *   SETTINGS-A-4: /settings/mutes → 「ミュート中のユーザー」 h1 + 単一 <main>
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

function requireEnv() {
	const required = {
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
	};
	for (const [k, v] of Object.entries(required)) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

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

const CASES: Array<{ path: string; heading: string; label: string }> = [
	{
		path: "/settings/profile",
		heading: "プロフィール編集",
		label: "SETTINGS-A-1",
	},
	{
		path: "/settings/notifications",
		heading: "通知の設定",
		label: "SETTINGS-A-2",
	},
	{
		path: "/settings/blocks",
		heading: "ブロック中のユーザー",
		label: "SETTINGS-A-3",
	},
	{
		path: "/settings/mutes",
		heading: "ミュート中のユーザー",
		label: "SETTINGS-A-4",
	},
];

test.describe("/settings A direction polish (#577)", () => {
	for (const c of CASES) {
		test(`${c.label}: ${c.path} → 「${c.heading}」 h1 + 単一 <main>`, async ({
			browser,
		}) => {
			requireEnv();
			const ctx = await browser.newContext();
			const page = await ctx.newPage();
			await loginViaApi(ctx.request, USER1);
			await page.goto(`${BASE}${c.path}`);

			await expect(
				page.getByRole("heading", { name: c.heading, level: 1 }),
			).toBeVisible({ timeout: 15000 });

			const mainCount = await page.locator("main").count();
			expect(mainCount).toBe(1);

			await ctx.close();
		});
	}
});
