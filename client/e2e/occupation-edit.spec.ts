/**
 * Phase 12 P12-06b 職業 chip 編集 + 表示 E2E spec (issue #818).
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §9.5
 *
 * 検証シナリオ:
 *   OCCUPATION-1 (golden):
 *     USER1 が /settings/profile を開く → 「デザイナー」 chip を選択 →
 *     「フロントエンドエンジニア」 chip を選択 → 「職業を保存」 → toast 通知 →
 *     /u/<USER1> に遷移すると chip が 2 件表示される
 *
 *   OCCUPATION-2 (max enforce):
 *     既に 3 件選択した状態で 4 件目 chip を click しても aria-checked が
 *     true にならず、 「最大 3 件まで」 のヒントが出る
 *
 *   OCCUPATION-3 (anon view):
 *     USER1 がセットした occupations は anon で /u/<USER1> を踏んでも
 *     chip 表示される (公開プロフィール)
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

async function clearOccupations(
	request: APIRequestContext,
	csrf: string,
): Promise<void> {
	const res = await request.put(`${BASE}/api/v1/users/me/occupations/`, {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${BASE}/settings/profile`,
		},
		data: { slugs: [] },
	});
	expect(res.status()).toBe(200);
}

test.describe("Phase 12 P12-06b occupation chip edit + display (#818)", () => {
	test("OCCUPATION-1: chip 選択 → 保存 → /u/<self> に chip 表示", async ({
		browser,
	}) => {
		requireEnv();
		const ctx = await browser.newContext();
		const { csrf } = await loginViaApi(ctx.request, USER1);
		await clearOccupations(ctx.request, csrf);

		const page = await ctx.newPage();
		await page.goto(`${BASE}/settings/profile`);

		// chip picker section の見出しが出るまで待つ
		await expect(
			page.getByRole("heading", { name: /職業/, level: 3 }),
		).toBeVisible({ timeout: 15000 });

		// 「デザイナー」 と 「フロントエンドエンジニア」 を switch chip として選ぶ
		const designer = page.getByRole("switch", { name: "デザイナー" });
		const frontend = page.getByRole("switch", {
			name: "フロントエンドエンジニア",
		});
		await expect(designer).toHaveAttribute("aria-checked", "false");
		await designer.click();
		await frontend.click();
		await expect(designer).toHaveAttribute("aria-checked", "true");
		await expect(frontend).toHaveAttribute("aria-checked", "true");

		// 保存 click → PUT 完了の signal を 2 つ待つ:
		//   1. toast の「職業を保存しました」 が見える (完了シグナル)
		//   2. 保存 button が再 disabled (savedSlugs と selected が一致した、 つまり PUT 反映済)
		// この 2 つを揃えてから profile 遷移しないと stg ネットワーク遅延で flaky になる
		// (code-reviewer HIGH 指摘)。
		const saveButton = page.getByRole("button", { name: "職業を保存" });
		await saveButton.click();
		await expect(page.getByText("職業を保存しました")).toBeVisible({
			timeout: 15000,
		});
		await expect(saveButton).toBeDisabled();

		// 自分のプロフィールに行って chip が見える
		await page.goto(`${BASE}/u/${USER1.handle}`);
		const occSection = page.getByRole("region", { name: "職業" });
		await expect(occSection).toBeVisible({ timeout: 15000 });
		await expect(occSection.getByText("デザイナー")).toBeVisible();
		await expect(
			occSection.getByText("フロントエンドエンジニア"),
		).toBeVisible();

		await ctx.close();
	});

	test("OCCUPATION-2: 4 件目は disabled + hint 表示", async ({ browser }) => {
		requireEnv();
		const ctx = await browser.newContext();
		const { csrf } = await loginViaApi(ctx.request, USER1);
		// 事前に 3 件入れておく
		const seed = await ctx.request.put(`${BASE}/api/v1/users/me/occupations/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${BASE}/settings/profile`,
			},
			data: { slugs: ["designer", "frontend", "backend"] },
		});
		expect(seed.status()).toBe(200);

		const page = await ctx.newPage();
		await page.goto(`${BASE}/settings/profile`);

		const fullstack = page.getByRole("switch", {
			name: "フルスタックエンジニア",
		});
		await expect(fullstack).toBeDisabled();
		await expect(page.getByTestId("occupation-limit-hint")).toBeVisible();

		// boundary: 既選択 chip を 1 つ外すと 4 件目が再び enable になる
		// (code-reviewer MEDIUM: 境界 test の対称性)
		await page.getByRole("switch", { name: "バックエンドエンジニア" }).click();
		await expect(fullstack).not.toBeDisabled();
		await expect(page.getByTestId("occupation-limit-hint")).not.toBeVisible();

		await ctx.close();
	});

	test("OCCUPATION-3: anon でも /u/<USER1> の chip が見える", async ({
		browser,
	}) => {
		requireEnv();
		// 自前で API seed して、 OCCUPATION-1 の実行順に依存しないようにする
		// (typescript-reviewer MEDIUM: spec 間の暗黙依存を排除)。
		const auth = await browser.newContext();
		const { csrf } = await loginViaApi(auth.request, USER1);
		const seed = await auth.request.put(
			`${BASE}/api/v1/users/me/occupations/`,
			{
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": csrf,
					Referer: `${BASE}/settings/profile`,
				},
				data: { slugs: ["designer", "frontend"] },
			},
		);
		expect(seed.status()).toBe(200);
		await auth.close();

		// anon (cookie 無し) で公開プロフィールを踏む
		const anon = await browser.newContext();
		const anonPage = await anon.newPage();
		await anonPage.goto(`${BASE}/u/${USER1.handle}`);

		const region = anonPage.getByRole("region", { name: "職業" });
		await expect(region).toBeVisible({ timeout: 15000 });
		await expect(region.getByText("デザイナー")).toBeVisible();
		await expect(region.getByText("フロントエンドエンジニア")).toBeVisible();

		await anon.close();
	});
});
