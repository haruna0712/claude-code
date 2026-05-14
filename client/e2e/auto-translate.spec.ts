/**
 * Phase 13 自動翻訳 機能 E2E (P13-05 / P13-07).
 *
 * spec: docs/specs/auto-translate-spec.md §7 §8.3
 *
 * シナリオ:
 *   1. USER2 が API で英文 tweet を投稿
 *   2. USER1 (preferred_language=ja) が /u/<USER2 handle> を開く
 *   3. 英文 tweet に「翻訳する」 button が出ていることを assert
 *   4. button click → POST /tweets/<id>/translate/ が fire され、 翻訳結果に
 *      切り替わる + 「原文を表示」 link が出る
 *   5. 「原文を表示」 click → 元 body に戻る + 「翻訳する」 button 再表示
 *
 * NOTE: stg に OPENAI_API_KEY が未注入の段階では NoopTranslator が原文を返すので
 *   `translated_text === original body` になる。 button / link の visible/state
 *   切り替えはそれでも検証できる。 P13-08 (terraform で key 注入) が済んで
 *   real translation を確認したい場合は別 spec を追加すること。
 *
 * 実行手順:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
 *   PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test2 \
 *   PLAYWRIGHT_USER2_EMAIL=test3@gmail.com \
 *   PLAYWRIGHT_USER2_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER2_HANDLE=test3 \
 *     npx playwright test e2e/auto-translate.spec.ts --reporter=line
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

async function apiPostTweet(authed: AuthedApi, body: string): Promise<number> {
	const res = await authed.api.post("/api/v1/tweets/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": authed.csrf,
			Referer: `${API_BASE}/`,
		},
		data: { body },
	});
	expect(res.status(), "tweet post").toBeLessThan(300);
	const json = await res.json();
	return json.id as number;
}

async function apiDeleteTweet(authed: AuthedApi, id: number): Promise<void> {
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
	await page.getByRole("button", { name: /Sign In/i }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Phase 13 自動翻訳 (P13-05 / P13-07)", () => {
	let user2: AuthedApi;
	let englishTweetId: number;

	test.beforeAll(async () => {
		user2 = await apiAuthed(USER2.email, USER2.password);
		englishTweetId = await apiPostTweet(
			user2,
			"Hello, world. This is an English test tweet for the translate feature.",
		);
	});

	test.afterAll(async () => {
		// 後片付け: 投稿した tweet を消す
		await apiDeleteTweet(user2, englishTweetId);
	});

	test("TRANSLATE-1/2: button toggles between original and translated body", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);

		// USER2 のプロフィールに行って英文 tweet を見つける
		await page.goto(`/u/${USER2.handle}`);
		const tweetCard = page
			.getByRole("article")
			.filter({ hasText: "English test tweet" })
			.first();
		await expect(tweetCard).toBeVisible({ timeout: 15_000 });

		// TRANSLATE-1: 翻訳 button が visible (USER1 default lang=ja !== tweet.language=en)
		const translateBtn = tweetCard.getByRole("button", { name: "翻訳する" });
		await expect(translateBtn).toBeVisible();

		// click → API fire → 「原文を表示」 link が出る
		await translateBtn.click();
		const revertBtn = tweetCard.getByRole("button", { name: "原文を表示" });
		await expect(revertBtn).toBeVisible({ timeout: 15_000 });
		// 翻訳 button は消える
		await expect(translateBtn).toBeHidden();

		// TRANSLATE-2: revert → 翻訳 button 再表示 / 「原文を表示」 消える
		await revertBtn.click();
		await expect(
			tweetCard.getByRole("button", { name: "翻訳する" }),
		).toBeVisible();
		await expect(revertBtn).toBeHidden();
	});

	test("TRANSLATE-3: same-language tweet has no translate button", async ({
		page,
	}) => {
		// USER2 が日本語 tweet を投稿 (USER1 default lang も ja → button 出ない)
		const jaTweetId = await apiPostTweet(
			user2,
			"こんにちは、 これは日本語のテストツイートです。",
		);
		try {
			await uiLogin(page, USER1.email, USER1.password);
			await page.goto(`/u/${USER2.handle}`);
			const jaCard = page
				.getByRole("article")
				.filter({ hasText: "日本語のテストツイート" })
				.first();
			await expect(jaCard).toBeVisible({ timeout: 15_000 });
			// 翻訳 button は出ない
			await expect(
				jaCard.getByRole("button", { name: "翻訳する" }),
			).toHaveCount(0);
		} finally {
			await apiDeleteTweet(user2, jaTweetId);
		}
	});

	test("TRANSLATE-4: own tweet has no translate button", async ({ page }) => {
		// USER1 (= viewer 自身) が英文 tweet を投稿 → 自分の TL / 自分の page では
		// 翻訳 button が出ない (per spec §7.1: author !== viewer 条件)
		const user1Api = await apiAuthed(USER1.email, USER1.password);
		const ownTweetId = await apiPostTweet(
			user1Api,
			"Hello, this is my own English tweet that should not show a translate button.",
		);
		try {
			await uiLogin(page, USER1.email, USER1.password);
			await page.goto(`/u/${USER1.handle}`);
			const ownCard = page
				.getByRole("article")
				.filter({ hasText: "my own English tweet" })
				.first();
			await expect(ownCard).toBeVisible({ timeout: 15_000 });
			await expect(
				ownCard.getByRole("button", { name: "翻訳する" }),
			).toHaveCount(0);
		} finally {
			await apiDeleteTweet(user1Api, ownTweetId);
		}
	});
});
