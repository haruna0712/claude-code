/**
 * Tweet delete scenarios.
 *
 * Spec source:
 *   docs/specs/tweet-delete-scenarios.md
 *
 * Run examples:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=<email> PLAYWRIGHT_USER1_PASSWORD=<password> PLAYWRIGHT_USER1_HANDLE=<handle> \
 *   PLAYWRIGHT_USER2_EMAIL=<email> PLAYWRIGHT_USER2_PASSWORD=<password> PLAYWRIGHT_USER2_HANDLE=<handle> \
 *   npx playwright test e2e/tweet-delete-scenarios.spec.ts --workers=1 --grep "DEL-01"
 */

import {
	expect,
	request,
	type APIRequestContext,
	type Locator,
	type Page,
	test,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

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

function requireCredentials() {
	for (const [name, value] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
		PLAYWRIGHT_USER2_HANDLE: USER2.handle,
	})) {
		if (!value) throw new Error(`${name} is required`);
	}
}

async function loginUI(page: Page, email: string, password: string) {
	await page.goto("/login");
	const emailInput = page
		.locator('input[name="email"], input[type="email"]')
		.first();
	await emailInput.fill(email);
	await page
		.locator('input[name="password"], input[type="password"]')
		.first()
		.fill(password);
	const signIn = page.getByRole("button", { name: "Sign In", exact: true });
	if (await signIn.isVisible().catch(() => false)) {
		await signIn.click();
	} else {
		await page.getByRole("button", { name: /ログイン/ }).click();
	}
	await page.waitForURL(/\/onboarding|\/$/);
}

async function postTweetUI(page: Page, body: string): Promise<number> {
	await page.goto("/");
	const textbox = page
		.getByRole("textbox", { name: "ツイート本文" })
		.or(page.getByRole("textbox", { name: /何を共有|本文/ }));
	await expect(textbox).toBeVisible({ timeout: 15_000 });
	await textbox.fill(body);
	const responsePromise = page.waitForResponse(
		(resp) =>
			resp.url().endsWith("/api/v1/tweets/") &&
			resp.request().method() === "POST",
	);
	await page.getByRole("button", { name: "投稿", exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(201);
	const payload = await response.json();
	return payload.id as number;
}

async function postTweetAs(user: typeof USER1, body: string): Promise<number> {
	const api = await apiAuthed(user.email, user.password);
	try {
		const response = await api.context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(response.status()).toBe(201);
		const payload = await response.json();
		return payload.id as number;
	} finally {
		await api.context.dispose();
	}
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

async function openTweet(page: Page, tweetId: number) {
	await page.goto(`/tweet/${tweetId}`);
	await expect(page.locator("article").first()).toBeVisible({
		timeout: 15_000,
	});
}

async function expectDeleteMenuVisible(page: Page) {
	const trigger = page.getByRole("button", {
		name: "ツイートのその他メニュー",
	});
	await expect(trigger).toBeVisible({ timeout: 5_000 });
	await trigger.click();
	await expect(page.getByRole("menuitem", { name: "削除" })).toBeVisible();
}

async function expectNoDeleteMenu(scope: Page | Locator) {
	await expect(
		scope.getByRole("button", { name: "ツイートのその他メニュー" }),
	).toHaveCount(0);
}

async function deleteVisibleTweet(page: Page) {
	const deleteItem = page.getByRole("menuitem", { name: "削除" });
	if (!(await deleteItem.isVisible().catch(() => false))) {
		await page
			.getByRole("button", { name: "ツイートのその他メニュー" })
			.click();
	}
	const responsePromise = page.waitForResponse(
		(resp) =>
			/\/api\/v1\/tweets\/\d+\/$/.test(new URL(resp.url()).pathname) &&
			resp.request().method() === "DELETE",
	);
	await deleteItem.click();
	const response = await responsePromise;
	expect(response.status()).toBe(204);
}

async function quoteTweetUI(
	page: Page,
	tweetId: number,
	body: string,
): Promise<number> {
	await openTweet(page, tweetId);
	await page.locator('[aria-label^="リポスト"]').first().click({ force: true });
	await page.getByRole("menuitem", { name: "引用" }).click();
	const textbox = page.getByRole("textbox", { name: "引用リポストの本文" });
	await expect(textbox).toBeVisible();
	await textbox.fill(body);
	const responsePromise = page.waitForResponse(
		(resp) =>
			resp.url().includes(`/api/v1/tweets/${tweetId}/quote/`) &&
			resp.request().method() === "POST",
	);
	await page.getByRole("button", { name: "引用する", exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(201);
	const payload = await response.json();
	return payload.id as number;
}

async function replyTweetUI(
	page: Page,
	tweetId: number,
	body: string,
): Promise<number> {
	await openTweet(page, tweetId);
	await page
		.getByRole("button", { name: /^リプライ/ })
		.first()
		.click();
	const textbox = page.getByRole("textbox", { name: "リプライの本文" });
	await expect(textbox).toBeVisible();
	await textbox.fill(body);
	const responsePromise = page.waitForResponse(
		(resp) =>
			resp.url().includes(`/api/v1/tweets/${tweetId}/reply/`) &&
			resp.request().method() === "POST",
	);
	await page.getByRole("button", { name: "返信する", exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(201);
	const payload = await response.json();
	return payload.id as number;
}

test.describe("tweet delete scenarios", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test("DEL-01: 自分の通常ツイートを削除する", async ({ page }) => {
		await loginUI(page, USER1.email, USER1.password);
		const marker = `DEL-01 ${Date.now()}`;
		const tweetId = await postTweetUI(page, marker);
		await openTweet(page, tweetId);

		await expectDeleteMenuVisible(page);
		await deleteVisibleTweet(page);
		await expect(page.getByText(marker)).toHaveCount(0);
	});

	test("DEL-02: 自分の引用リポストを削除する", async ({ page }) => {
		const sourceId = await postTweetAs(USER2, `DEL-02 source ${Date.now()}`);
		await loginUI(page, USER1.email, USER1.password);
		const quoteId = await quoteTweetUI(
			page,
			sourceId,
			`DEL-02 quote ${Date.now()}`,
		);
		await openTweet(page, quoteId);

		await expectDeleteMenuVisible(page);
		await deleteVisibleTweet(page);
	});

	test("DEL-03: 自分の返信を削除する", async ({ page }) => {
		const parentId = await postTweetAs(USER2, `DEL-03 parent ${Date.now()}`);
		await loginUI(page, USER1.email, USER1.password);
		const replyId = await replyTweetUI(
			page,
			parentId,
			`DEL-03 reply ${Date.now()}`,
		);
		await openTweet(page, replyId);

		await expectDeleteMenuVisible(page);
		await deleteVisibleTweet(page);
	});

	test("DEL-04: 自分のリポストを取り消す", async ({ page }) => {
		const sourceId = await postTweetAs(USER2, `DEL-04 source ${Date.now()}`);
		await loginUI(page, USER1.email, USER1.password);
		await openTweet(page, sourceId);
		await page
			.locator('[aria-label="リポスト"]')
			.first()
			.click({ force: true });
		const postResponse = page.waitForResponse(
			(resp) =>
				resp.url().includes(`/api/v1/tweets/${sourceId}/repost/`) &&
				resp.request().method() === "POST",
		);
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		expect([200, 201]).toContain((await postResponse).status());

		await page.reload();
		await page
			.locator('[aria-label="リポスト済み"]')
			.first()
			.click({ force: true });
		const deleteResponse = page.waitForResponse(
			(resp) =>
				resp.url().includes(`/api/v1/tweets/${sourceId}/repost/`) &&
				resp.request().method() === "DELETE",
		);
		await page.getByRole("menuitem", { name: "リポストを取り消す" }).click();
		expect((await deleteResponse).status()).toBe(204);
		await expect(page.locator('[aria-label="リポスト"]')).toBeVisible();
	});

	test("DEL-05: 他人のツイートを自分がリポストした行に通常削除メニューは出さない", async ({
		page,
	}) => {
		const marker = `DEL-05 source ${Date.now()}`;
		const sourceId = await postTweetAs(USER2, marker);
		await loginUI(page, USER1.email, USER1.password);
		await openTweet(page, sourceId);
		await page
			.locator('[aria-label="リポスト"]')
			.first()
			.click({ force: true });
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		await page.goto("/");

		const repostArticle = page
			.locator("article")
			.filter({ hasText: marker })
			.filter({ hasText: "がリポストしました" })
			.first();
		await expect(repostArticle).toBeVisible();
		await expectNoDeleteMenu(repostArticle);
	});

	test("DEL-05b: 自分のツイートを自分がリポストした行ではsource tweetを削除できる", async ({
		page,
	}) => {
		const marker = `DEL-05b source ${Date.now()}`;
		const sourceId = await postTweetAs(USER1, marker);
		await loginUI(page, USER1.email, USER1.password);
		await openTweet(page, sourceId);
		await page
			.locator('[aria-label="リポスト"]')
			.first()
			.click({ force: true });
		await page.getByRole("menuitem", { name: "リポスト" }).click();
		await page.goto("/");

		const repostArticle = page
			.locator("article")
			.filter({ hasText: marker })
			.filter({ hasText: "がリポストしました" })
			.first();
		await expect(repostArticle).toBeVisible();
		await repostArticle
			.getByRole("button", { name: "ツイートのその他メニュー" })
			.click();
		const responsePromise = page.waitForResponse(
			(resp) =>
				/\/api\/v1\/tweets\/\d+\/$/.test(new URL(resp.url()).pathname) &&
				resp.request().method() === "DELETE",
		);
		await page.getByRole("menuitem", { name: "削除" }).click();
		const response = await responsePromise;
		expect(response.status()).toBe(204);
		expect(new URL(response.url()).pathname).toBe(
			`/api/v1/tweets/${sourceId}/`,
		);
		await expect(repostArticle).toHaveCount(0);
	});

	test("DEL-06: 他人の通常ツイートは削除できない", async ({ page }) => {
		const tweetId = await postTweetAs(USER2, `DEL-06 source ${Date.now()}`);
		await loginUI(page, USER1.email, USER1.password);
		await openTweet(page, tweetId);

		await expectNoDeleteMenu(page);
	});

	test("DEL-07: 他人の引用リポストは削除できない", async ({
		browser,
		page,
	}) => {
		const sourceId = await postTweetAs(USER1, `DEL-07 source ${Date.now()}`);
		const context = await browser.newContext();
		const bPage = await context.newPage();
		await loginUI(bPage, USER2.email, USER2.password);
		const quoteId = await quoteTweetUI(
			bPage,
			sourceId,
			`DEL-07 quote ${Date.now()}`,
		);
		await context.close();

		await loginUI(page, USER1.email, USER1.password);
		await openTweet(page, quoteId);
		await expectNoDeleteMenu(page);
	});
});
