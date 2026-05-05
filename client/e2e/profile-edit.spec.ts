/**
 * Profile edit scenarios.
 *
 * Spec source:
 *   docs/specs/profile-edit-e2e-scenarios.md
 */

import {
	expect,
	request,
	type APIRequestContext,
	type Page,
	test,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

interface CurrentUserProfile {
	username: string;
	display_name: string;
	bio: string;
	github_url?: string;
}

function requireCredentials() {
	for (const [name, value] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
	})) {
		if (!value) throw new Error(`${name} is required`);
	}
}

async function loginUI(page: Page, email: string, password: string) {
	await page.goto("/login");
	await page
		.locator('input[name="email"], input[type="email"]')
		.first()
		.fill(email);
	await page
		.locator('input[name="password"], input[type="password"]')
		.first()
		.fill(password);
	await page.getByRole("button", { name: "Sign In", exact: true }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

async function apiAuthed(
	email: string,
	password: string,
): Promise<{ context: APIRequestContext; csrf: string }> {
	const context = await request.newContext({ baseURL: API_BASE });
	await context.get("/api/v1/auth/csrf/");
	const storageState = await context.storageState();
	const csrf =
		storageState.cookies.find((cookie) => cookie.name === "csrftoken")?.value ??
		"";

	const loginResponse = await context.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(loginResponse.status(), `login failed for ${email}`).toBe(200);

	const nextStorageState = await context.storageState();
	const nextCsrf =
		nextStorageState.cookies.find((cookie) => cookie.name === "csrftoken")
			?.value ?? csrf;

	return { context, csrf: nextCsrf };
}

async function fetchCurrentUser(
	api: APIRequestContext,
): Promise<CurrentUserProfile> {
	const response = await api.get("/api/v1/users/me/");
	expect(response.status()).toBe(200);
	return (await response.json()) as CurrentUserProfile;
}

async function patchCurrentUser(
	api: APIRequestContext,
	csrf: string,
	payload: Partial<CurrentUserProfile>,
) {
	const response = await api.patch("/api/v1/users/me/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": csrf,
			Referer: `${API_BASE}/settings/profile`,
		},
		data: payload,
	});
	expect(response.status()).toBe(200);
}

test.describe("profile edit scenarios", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test("PROF-01: 自分のプロフィールページに編集導線が表示される", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto(`/u/${USER1.handle}`);

		const editLink = page.getByRole("link", { name: "プロフィールを編集" });
		await expect(editLink).toBeVisible();
		await expect(editLink).toHaveAttribute("href", "/settings/profile");
	});

	test("PROF-02: プロフィール編集ページで表示名と自己紹介を保存できる", async ({
		page,
	}) => {
		const authed = await apiAuthed(USER1.email, USER1.password);
		const original = await fetchCurrentUser(authed.context);
		const marker = Date.now();
		const displayName = `E2E Profile ${marker}`;
		const bio = `profile edit e2e ${marker}`;

		try {
			await loginUI(page, USER1.email, USER1.password);
			await page.goto("/settings/profile");
			await expect(
				page.getByRole("heading", { name: "プロフィール編集" }),
			).toBeVisible();

			await page.locator("#display_name").fill(displayName);
			await page.locator("#bio").fill(bio);
			const patchResponse = page.waitForResponse(
				(resp) =>
					resp.url().endsWith("/api/v1/users/me/") &&
					resp.request().method() === "PATCH",
			);
			await page.getByRole("button", { name: "保存", exact: true }).click();
			expect((await patchResponse).status()).toBe(200);

			await page.waitForURL(new RegExp(`/u/${USER1.handle}$`));
			await expect(
				page.getByRole("heading", { name: displayName }),
			).toBeVisible();
			await expect(page.getByText(bio)).toBeVisible();
		} finally {
			await patchCurrentUser(authed.context, authed.csrf, {
				display_name: original.display_name,
				bio: original.bio,
			});
			await authed.context.dispose();
		}
	});

	test("PROF-03: プロフィール編集ページに画像切り抜きUIの入口が表示される", async ({
		page,
	}) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto("/settings/profile");

		await expect(
			page.getByRole("button", { name: /アバターを(追加|変更)/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /ヘッダーを(追加|変更)/ }),
		).toBeVisible();
	});

	test("PROF-04: 外部リンクURLはhttpsのみ許可する", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		await page.goto("/settings/profile");

		await page.locator("#github_url").fill("http://example.com");
		await page.locator("#display_name").fill(`Invalid URL ${Date.now()}`);
		await page.getByRole("button", { name: "保存", exact: true }).click();

		await expect(
			page.getByText("https:// で始まるURLを入力してください"),
		).toBeVisible();
	});
});
