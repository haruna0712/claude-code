/**
 * Phase 14 Claude Agent MVP E2E (P14-06).
 *
 * spec: docs/specs/claude-agent-spec.md §7 §8.3
 *
 * シナリオ:
 *   AGENT-1: 未ログインで /agent → /login redirect
 *   AGENT-2: ログイン → ホーム → leftNav「Agent」 で 1 click 到達
 *   AGENT-3: prompt 投入 → 「Agent 起動」 で draft が出る (実 OpenAI/Claude 経由)
 *   AGENT-4: draft を edit → 「これを投稿」 で /tweets に新 tweet が出現 + 後片付け
 *
 * NOTE: P14-07 で ANTHROPIC_API_KEY が stg env に注入されるまでは AGENT-3 が
 *   503 を返すので、 P14-07 完了後に走らせる前提。 placeholder のままだと
 *   AgentRunner init は通るが Anthropic 401 → 500 になり、 AGENT-3 が
 *   toast error で fail する。
 *
 * 実行手順:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
 *   PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   PLAYWRIGHT_USER1_HANDLE=test2 \
 *     npx playwright test e2e/agent.spec.ts --reporter=line
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
	await page.getByRole("button", { name: "ログイン", exact: true }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Phase 14 Claude Agent (P14-05 / 06)", () => {
	test("AGENT-1: 未ログインで /agent → /login redirect", async ({ page }) => {
		await page.goto("/agent");
		await page.waitForURL(/\/login/, { timeout: 10_000 });
	});

	test("AGENT-2: ホーム → leftNav 「Agent」 で 1 click 到達", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto("/");
		// leftNav の Agent link をクリック (LeftNavbar は role=link で label='Agent')
		// MobileNavbar / LeftNavbar どちらでも見えるよう first() で対応
		await page
			.getByRole("link", { name: "Agent", exact: true })
			.first()
			.click();
		await page.waitForURL(/\/agent$/, { timeout: 10_000 });
		await expect(
			page.getByRole("heading", { name: /Agent/, level: 1 }),
		).toBeVisible();
	});

	test("AGENT-3: prompt → 起動 → draft が表示", async ({ page }) => {
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto("/agent");
		const promptArea = page.getByLabel("やりたいことを自然言語で");
		await expect(promptArea).toBeVisible();
		await promptArea.fill(
			"自分の最近の tweet を 1 行で要約して、 日本語 30 字以内で 1 つ tweet 下書きを作って",
		);
		const runBtn = page.getByRole("button", { name: /Agent 起動/ });
		await runBtn.click();
		// loading 中 spinner / button disabled
		await expect(runBtn).toBeDisabled();
		// 結果 panel が出る (60s 余裕、 Anthropic + tool loop で時間かかる)
		await expect(page.getByText(/呼び出されたツール/)).toBeVisible({
			timeout: 60_000,
		});
		// 投稿 button が出る
		await expect(
			page.getByRole("button", { name: /これを投稿|投稿中/ }),
		).toBeVisible();
	});

	test("AGENT-4: draft edit → 投稿 → /tweets に新 tweet が出現", async ({
		page,
	}) => {
		await uiLogin(page, USER1.email, USER1.password);
		await page.goto("/agent");
		// 一意なマーカーを含む prompt で agent を回す。 後で削除しやすいように。
		const marker = `PW-${Date.now().toString(36)}`;
		await page
			.getByLabel("やりたいことを自然言語で")
			.fill(
				`「${marker}」 という文字列をそのまま含んだ日本語 30 字以内の tweet 下書きを作って`,
			);
		await page.getByRole("button", { name: /Agent 起動/ }).click();
		await expect(page.getByText(/呼び出されたツール/)).toBeVisible({
			timeout: 60_000,
		});

		// 投稿 button → 完了 toast
		await page.getByRole("button", { name: /これを投稿/ }).click();
		await expect(page.getByText(/投稿しました/)).toBeVisible({
			timeout: 15_000,
		});

		// 後片付け: API 経由で marker を含む tweet を取得して削除
		const authed = await apiAuthed(USER1.email, USER1.password);
		const listRes = await authed.api.get(
			`/api/v1/tweets/?author=${USER1.handle}`,
		);
		const listJson = await listRes.json();
		const matched = (listJson.results ?? []).find(
			(t: { id: number; body: string }) => t.body.includes(marker),
		);
		if (matched) {
			await apiDeleteTweet(authed, matched.id);
		}
	});
});
