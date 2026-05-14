/**
 * #734 Tweet 下書き機能 E2E (Playwright)。
 *
 * spec: docs/specs/tweet-drafts-spec.md §6.3
 *
 * シナリオ:
 *   DRAFTS-1: ホーム → leftNav「下書き」 1 click で `/drafts` 到達
 *   DRAFTS-2: composer で「下書き保存」 → /drafts に出現、 home TL に出ない
 *   DRAFTS-3: 「公開する」 click → home TL に出る + /drafts から消える
 *   DRAFTS-4: 別 user の draft URL を直接踏むと 404
 *   DRAFTS-5: 後片付け (作った tweet を API 経由で削除)
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
 *   PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test2 \
 *   PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
 *   PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER2_HANDLE=test3 \
 *     npx playwright test e2e/drafts.spec.ts --reporter=line
 */

import {
	expect,
	request,
	test,
	type APIRequestContext,
	type Page,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "alice@example.com",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "alice",
};

const USER2 = {
	email: process.env.PLAYWRIGHT_USER2_EMAIL ?? "bob@example.com",
	password: process.env.PLAYWRIGHT_USER2_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER2_HANDLE ?? "bob",
};

interface AuthedApi {
	api: APIRequestContext;
	csrf: string;
}

async function apiAuthed(email: string, password: string): Promise<AuthedApi> {
	const api = await request.newContext({ baseURL: API_BASE });
	await api.get("/api/v1/auth/csrf/");
	const cookies = await api.storageState();
	const csrf = cookies.cookies.find((c) => c.name === "csrftoken")?.value ?? "";
	const loginRes = await api.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(loginRes.status(), `login failed for ${email}`).toBe(200);
	const cookies2 = await api.storageState();
	const csrf2 =
		cookies2.cookies.find((c) => c.name === "csrftoken")?.value ?? csrf;
	return { api, csrf: csrf2 };
}

async function apiDeleteTweet(
	authed: AuthedApi,
	id: number | string,
): Promise<void> {
	await authed.api.delete(`/api/v1/tweets/${id}/`, {
		headers: {
			"X-CSRFToken": authed.csrf,
			Referer: `${API_BASE}/`,
		},
	});
}

async function uiLogin(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page.getByLabel("Email Address").fill(email);
	await page.getByPlaceholder("Password").fill(password);
	await page.getByRole("button", { name: "ログイン", exact: true }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("#734 Tweet 下書き機能", () => {
	test("DRAFTS-1: ホーム → leftNav「下書き」 1 click で /drafts 到達", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto("/");
		await page
			.getByRole("link", { name: "下書き", exact: true })
			.first()
			.click();
		await page.waitForURL(/\/drafts$/, { timeout: 10_000 });
		await expect(
			page.getByRole("heading", { name: "下書き", level: 1 }),
		).toBeVisible();
	});

	test("DRAFTS-2: 「下書き保存」 → /drafts に出現、 home TL に出ない", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);

		// composer を開いて draft 保存
		const marker = `DRAFT-${Date.now().toString(36)}`;
		const body = `PWテスト下書き ${marker}`;

		// 投稿 dialog を開く (左 nav の「投稿する」 button)
		await page.goto("/");
		await page
			.getByRole("button", { name: /投稿する|投稿/ })
			.first()
			.click();
		const textarea = page.getByPlaceholder(/いまどうしてる/);
		await expect(textarea).toBeVisible({ timeout: 10_000 });
		await textarea.fill(body);
		await page
			.getByRole("button", { name: /下書きとして保存/ })
			.first()
			.click();

		// toast「下書きに保存しました」
		await expect(page.getByText(/下書きに保存しました/)).toBeVisible({
			timeout: 10_000,
		});

		// /drafts に出現
		await page.goto("/drafts");
		await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });

		// home TL には出ない (= 公開タイムラインで marker が見えないこと)
		await page.goto("/");
		// home TL 領域内に marker が無いことを確認 (上限 5 秒で見つからなければ OK)
		await page.waitForLoadState("networkidle");
		await expect(page.getByText(marker)).not.toBeVisible();

		// 後片付け: draft を削除
		const authed = await apiAuthed(USER1.email, USER1.password);
		const draftsResp = await authed.api.get("/api/v1/tweets/drafts/");
		const draftsJson = await draftsResp.json();
		const items = draftsJson.results ?? draftsJson;
		const found = items.find((t: { id: number; body: string }) =>
			t.body.includes(marker),
		);
		if (found) {
			await apiDeleteTweet(authed, found.id);
		}
	});

	test("DRAFTS-3: 「公開する」 → home TL に出る + /drafts から消える", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);
		const marker = `PUBLISHED-${Date.now().toString(36)}`;
		const body = `PWテスト公開ドラフト ${marker}`;

		// API 経由で draft を作る (UI 経由は DRAFTS-2 でカバー、 ここは publish の挙動を試す)
		const authed = await apiAuthed(USER1.email, USER1.password);
		const createResp = await authed.api.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": authed.csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body, is_draft: true },
		});
		expect(createResp.status()).toBe(201);
		const created = await createResp.json();
		const draftId = created.id as number;

		// /drafts で「公開する」 click
		await page.goto("/drafts");
		await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 });
		// この draft 行内の「下書きを公開する」 button を押す
		const row = page.locator("li", { hasText: marker }).first();
		await row.getByRole("button", { name: "下書きを公開する" }).click();

		await expect(page.getByText(/公開しました/)).toBeVisible({
			timeout: 10_000,
		});
		// 行が消える
		await expect(page.getByText(marker)).not.toBeVisible();

		// home TL に出る
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await expect(page.getByText(marker)).toBeVisible({ timeout: 15_000 });

		// 後片付け: 公開 tweet を削除
		await apiDeleteTweet(authed, draftId);
	});

	test("DRAFTS-4: 別 user の draft URL を直接踏むと 404", async ({ page }) => {
		// USER1 が draft を作る
		const authed = await apiAuthed(USER1.email, USER1.password);
		const marker = `HIDE-${Date.now().toString(36)}`;
		const createResp = await authed.api.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": authed.csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body: `secret draft ${marker}`, is_draft: true },
		});
		expect(createResp.status()).toBe(201);
		const draftId = (await createResp.json()).id as number;

		// USER2 で login して USER1 の draft 詳細 URL を踏む
		await uiLogin(page, USER2.email, USER2.password);
		const resp = await page.goto(`/tweet/${draftId}`);
		// SSR で 404 page になる or backend が 404 を返す
		// frontend page route が 404 を返さない場合は body 上に「見つかりません」 等が出る
		// ここでは status code or 文字列を見て判定
		const status = resp?.status();
		// Next.js の notFound() は通常 404 status を返す。 もし 200 + 「見つかりません」
		// なら下のテキスト判定で吸収。
		if (status === 404) {
			// OK
		} else {
			await expect(page.getByText(/見つかりません|Not found|404/)).toBeVisible({
				timeout: 5_000,
			});
		}

		// 後片付け
		await apiDeleteTweet(authed, draftId);
	});
});
