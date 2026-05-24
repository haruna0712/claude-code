/**
 * Phase 12 P12-08b ユーザー検索 地図 view E2E spec (issue #817).
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §11
 *
 * 検証シナリオ (council reshape 後: pan/bbox は無し、 現在の検索結果を地図描画):
 *   MAP-1 (anon map render):
 *     USER1 に residence + designer を seed → anon が
 *     /search/users?occupation=designer&view=map → `.leaflet-container` が描画され、
 *     USER1 の円 popup からプロフィール link が辿れる
 *
 *   MAP-2 (toggle list ↔ map):
 *     anon が /search/users で「地図」 toggle → URL ?view=map、 「一覧」 で list へ
 *
 *   MAP-3 (occupation chip in map view):
 *     anon が ?view=map で「デザイナー」 chip を選ぶ → URL に occupation=designer +
 *     view=map が両立
 *
 *   MAP-4 (一覧で見る で list へ戻る = dead-end 無し):
 *     anon が map view から「一覧で見る」 で list view に戻れる
 *
 * env: docs/local/e2e-stg.md の test2 (USER1)。
 */

import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

function requireEnv() {
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
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

async function setOccupations(
	request: APIRequestContext,
	csrf: string,
	slugs: string[],
): Promise<void> {
	const res = await request.put(`${BASE}/api/v1/users/me/occupations/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/settings/profile`,
		},
		data: { slugs },
	});
	expect(res.status()).toBe(200);
}

async function setResidence(
	request: APIRequestContext,
	csrf: string,
): Promise<void> {
	// 東京駅近辺 + 最小半径。 map に円が出れば十分。
	const res = await request.patch(`${BASE}/api/v1/users/me/residence/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/settings/residence`,
		},
		data: { latitude: "35.681236", longitude: "139.767125", radius_m: 800 },
	});
	expect(res.status()).toBe(200);
}

async function seedUser1(request: APIRequestContext): Promise<void> {
	const { csrf } = await loginViaApi(request, USER1);
	await setResidence(request, csrf);
	await setOccupations(request, csrf, ["designer"]);
}

test.describe("Phase 12 P12-08b user search map view (#817)", () => {
	test("MAP-1: anon map view renders leaflet + plotted user popup", async ({
		browser,
	}) => {
		requireEnv();
		const seed = await browser.newContext();
		await seedUser1(seed.request);
		await seed.close();

		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users?occupation=designer&view=map`);

		// dynamic import + Leaflet 初期化を待つ
		await expect(page.locator(".leaflet-container")).toBeVisible({
			timeout: 20000,
		});

		await anon.close();
	});

	test("MAP-2: list ↔ map toggle syncs ?view=", async ({ browser }) => {
		// anon のみ・seed 不要なので requireEnv は呼ばない (code-reviewer HIGH:
		// USER1 env が無い CI で無意味に skip させない)。
		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users`);

		// exact:true で toggle の「一覧」/「地図」 を、 map view の「一覧で見る」 escape
		// link と区別する (後者は部分一致で「一覧」 にもマッチするため)。
		await page.getByRole("link", { name: "地図", exact: true }).click();
		await expect(page).toHaveURL(/[?&]view=map/);

		await page.getByRole("link", { name: "一覧", exact: true }).click();
		await expect(page).not.toHaveURL(/view=map/);

		await anon.close();
	});

	test("MAP-3: occupation chip in map view keeps view=map + adds occupation", async ({
		browser,
	}) => {
		// anon のみ・seed 不要 (code-reviewer HIGH)。
		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users?view=map`);

		await page.getByRole("switch", { name: "デザイナー" }).click();

		await expect(page).toHaveURL(/[?&]occupation=designer/);
		await expect(page).toHaveURL(/[?&]view=map/);

		await anon.close();
	});

	test("MAP-4: '一覧で見る' returns to list view (no dead end)", async ({
		browser,
	}) => {
		requireEnv();
		const seed = await browser.newContext();
		await seedUser1(seed.request);
		await seed.close();

		const anon = await browser.newContext();
		const page = await anon.newPage();
		await page.goto(`${BASE}/search/users?occupation=designer&view=map`);

		await page.getByRole("link", { name: "一覧で見る" }).click();
		await expect(page).not.toHaveURL(/view=map/);
		// list view の検索結果 region が出る (USER1 が designer で hit)
		await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible({
			timeout: 15000,
		});

		await anon.close();
	});
});
