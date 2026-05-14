/**
 * #735 鍵アカ + フォロー承認制 E2E (Playwright)。
 *
 * spec: docs/specs/private-account-spec.md §6.3
 *
 * シナリオ:
 *   PRIVATE-1: USER2 が settings で鍵化 → profile を踏むと「非公開」 表示
 *   PRIVATE-2: USER1 が USER2 を follow → button「承認待ち」
 *   PRIVATE-3: USER2 が /follow-requests で承認 → USER1 で USER2 tweet が見える
 *   PRIVATE-4: USER2 が鍵を解除 → 既存 pending follow が approved になる
 *
 * 実行コマンド:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
 *   PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test2 \
 *   PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
 *   PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER2_HANDLE=test3 \
 *     npx playwright test e2e/private-account.spec.ts --reporter=line
 *
 * NOTE: テスト後に USER2 の is_private を **false に戻す** (= 後片付け)。
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

async function apiSetPrivate(
	authed: AuthedApi,
	isPrivate: boolean,
): Promise<void> {
	const r = await authed.api.patch("/api/v1/users/me/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": authed.csrf,
			Referer: `${API_BASE}/settings/profile`,
		},
		data: { is_private: isPrivate },
	});
	expect(r.status(), `PATCH is_private=${isPrivate} failed`).toBe(200);
}

async function apiUnfollow(authed: AuthedApi, handle: string): Promise<void> {
	await authed.api.delete(`/api/v1/users/${handle}/follow/`, {
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

test.describe("#735 鍵アカ + フォロー承認制", () => {
	test.beforeAll(async () => {
		// USER2 を必ず公開状態 (is_private=false) で開始する
		const u2 = await apiAuthed(USER2.email, USER2.password);
		await apiSetPrivate(u2, false);
		// 既存の follow 関係も解除しておく (= clean slate)
		const u1 = await apiAuthed(USER1.email, USER1.password);
		await apiUnfollow(u1, USER2.handle);
	});

	test.afterAll(async () => {
		// 後片付け: USER2 を公開に戻し、 follow も解除
		const u2 = await apiAuthed(USER2.email, USER2.password);
		await apiSetPrivate(u2, false);
		const u1 = await apiAuthed(USER1.email, USER1.password);
		await apiUnfollow(u1, USER2.handle);
	});

	test("PRIVATE-1〜4: 鍵化 → follow → 承認 → 解除 のフルフロー", async ({
		page,
	}) => {
		// --- PRIVATE-1: USER2 で鍵化 ---
		const u2Authed = await apiAuthed(USER2.email, USER2.password);
		await apiSetPrivate(u2Authed, true);

		// --- PRIVATE-2: USER1 で USER2 を follow ---
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto(`/u/${USER2.handle}`);
		const followBtn = page
			.getByRole("button", { name: new RegExp(`@${USER2.handle} をフォロー`) })
			.first();
		await expect(followBtn).toBeVisible({ timeout: 10_000 });
		await followBtn.click();
		// 「承認待ち」 button に変わる
		await expect(page.getByRole("button", { name: /承認待ち/ })).toBeVisible({
			timeout: 10_000,
		});

		// --- PRIVATE-3: USER2 が /follow-requests で承認 ---
		// 一度 logout してから USER2 で login
		await page.context().clearCookies();
		await uiLogin(page, USER2.email, USER2.password);
		await page.goto("/follow-requests");
		// USER1 の row が出ている
		await expect(page.getByText(`@${USER1.handle}`)).toBeVisible({
			timeout: 10_000,
		});
		// 承認 button click
		await page
			.getByRole("button", {
				name: new RegExp(`@${USER1.handle} のフォロー申請を承認`),
			})
			.click();
		await expect(page.getByText(/承認しました/)).toBeVisible({
			timeout: 10_000,
		});

		// --- PRIVATE-4: USER1 で再ログインして USER2 の tweet が見える状態を確認 ---
		await page.context().clearCookies();
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto(`/u/${USER2.handle}`);
		// FollowButton が「フォロー中」 (承認済み)
		await expect(page.getByRole("button", { name: /フォロー中/ })).toBeVisible({
			timeout: 10_000,
		});
	});
});
