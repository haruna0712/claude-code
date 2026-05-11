/**
 * ArticleEditor の live preview + 画像 upload E2E (#536 / PR C).
 *
 * Spec: docs/specs/article-editor-enhancements-spec.md §5.2
 *
 * シナリオ:
 *   ARTICLE-EDITOR-IMG-1: /articles/new で本文 markdown を入力 → preview pane に
 *                         rendered HTML (heading) が出る
 *   ARTICLE-EDITOR-IMG-2: 「画像を追加」 button → file 選択 → upload 成功 →
 *                         markdown 本文に ![filename](url) が挿入 + toast 「追加しました」
 *   ARTICLE-EDITOR-IMG-3: 5MB+1 を drop → toast.error、 markdown に挿入されない
 *
 * env: docs/local/e2e-stg.md の test2 を使用。
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
): Promise<void> {
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

/** 8x8 PNG (透過、 ~70B) を Buffer で生成。 e2e で本物 file アップロードに使う。 */
function tinyPngBuffer(): Buffer {
	// data:image/png base64 の最小有効 png (1x1 transparent)
	const b64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
	return Buffer.from(b64, "base64");
}

test.describe("ArticleEditor live preview + 画像 upload (#536)", () => {
	test.beforeAll(() => requireEnv());

	test("ARTICLE-EDITOR-IMG-1: preview pane に rendered HTML が出る", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		await loginViaApi(ctx.request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/new`);

		const textarea = page.getByLabel("本文 (Markdown)", { exact: false });
		await expect(textarea).toBeVisible({ timeout: 15000 });
		await textarea.fill("# Hello Preview\n\nbody text **bold**");

		// preview pane に <h1>Hello Preview</h1>
		await expect(
			page.getByRole("heading", { name: "Hello Preview", level: 1 }),
		).toBeVisible({ timeout: 5000 });

		await ctx.close();
	});

	test("ARTICLE-EDITOR-IMG-2: 画像を追加 button → file 選択 → markdown に挿入", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		await loginViaApi(ctx.request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/new`);

		// 「画像を追加」 button の隣の hidden input を取得して file を投入
		const fileInput = page.locator('input[type="file"][accept*="image"]');
		await fileInput.setInputFiles({
			name: "e2e-shot.png",
			mimeType: "image/png",
			buffer: tinyPngBuffer(),
		});

		// toast 「追加しました」 が見える (react-toastify は role=alert)
		await expect(page.getByText(/追加しました/)).toBeVisible({
			timeout: 30000,
		});

		// markdown 本文 textarea に ![e2e-shot.png](https://...) が挿入されている
		const textareaValue = await page
			.getByLabel("本文 (Markdown)", { exact: false })
			.inputValue();
		expect(textareaValue).toMatch(/!\[e2e-shot\.png\]\(https?:\/\/.+\)/);

		// preview pane に <img> が描画される
		await expect(
			page.getByRole("img", { name: "e2e-shot.png" }).first(),
		).toBeVisible({ timeout: 5000 });

		await ctx.close();
	});

	test("ARTICLE-EDITOR-IMG-3: 5MB+1 を選択 → toast.error、 markdown 変化なし", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		await loginViaApi(ctx.request, USER1);
		const page = await ctx.newPage();
		await page.goto(`${BASE}/articles/new`);

		// 5 MiB + 1 byte の buffer
		const oversize = Buffer.alloc(5 * 1024 * 1024 + 1, 0);
		const fileInput = page.locator('input[type="file"][accept*="image"]');
		await fileInput.setInputFiles({
			name: "huge.png",
			mimeType: "image/png",
			buffer: oversize,
		});

		// toast.error が出る (「失敗」 / 「サイズ」 等を含む)
		await expect(page.getByText(/失敗|サイズ/)).toBeVisible({
			timeout: 15000,
		});

		// markdown には挿入されない (空のまま)
		const textareaValue = await page
			.getByLabel("本文 (Markdown)", { exact: false })
			.inputValue();
		expect(textareaValue).not.toMatch(/!\[huge\.png\]/);

		await ctx.close();
	});
});
