/**
 * DM 添付表示 UI E2E (Issue #464).
 *
 * PR #455 反省: API curl だけで「E2E pass」を主張しない。本 spec は
 * `setInputFiles` で実際にファイル picker を起動 → S3 → confirm → WS 送信 →
 * 受信側 bubble に <img> が render されるまでを **UI 経由** で踏む。
 *
 * Spec: docs/specs/dm-attachment-display-spec.md
 * Scenarios: docs/specs/dm-attachment-display-scenarios.md
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com PLAYWRIGHT_USER1_PASSWORD=... \
 *   PLAYWRIGHT_USER2_EMAIL=test3@gmail.com PLAYWRIGHT_USER2_PASSWORD=... \
 *   PLAYWRIGHT_ROOM_ID=1 \
 *   npx playwright test e2e/dm-attachment-display.spec.ts --workers=1
 */

import path from "node:path";

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

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
const ROOM_ID = Number(process.env.PLAYWRIGHT_ROOM_ID ?? 1);

const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/sample-image.png");
const FIXTURE_DOC = path.resolve(__dirname, "fixtures/sample-doc.pdf");

function requireCredentials() {
	for (const [k, v] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER2_EMAIL: USER2.email,
		PLAYWRIGHT_USER2_PASSWORD: USER2.password,
	})) {
		if (!v) throw new Error(`${k} is not set`);
	}
}

/**
 * SPA への login: cookie set 経路で /messages にアクセス可能にする。
 */
async function loginViaApi(
	page: import("@playwright/test").Page,
	user: { email: string; password: string },
) {
	// CSRF cookie 種付け (GET エンドポイント)
	const resp = await page.context().request.get(`${BASE}/api/v1/auth/csrf/`);
	expect(resp.status()).toBeLessThan(400);
	const cookies = await page.context().cookies(BASE);
	const csrf = cookies.find((c) => c.name === "csrftoken")?.value ?? "";
	const login = await page
		.context()
		.request.post(`${BASE}/api/v1/auth/cookie/create/`, {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": csrf,
				Referer: `${BASE}/login`,
			},
			data: { email: user.email, password: user.password },
		});
	expect(login.status()).toBe(200);
}

test.describe("DM 添付表示 — 本物の UI E2E (Issue #464)", () => {
	test.beforeEach(() => {
		requireCredentials();
	});

	test("ATT-IMG: setInputFiles で画像を送信 → bubble に <img> が出る → click で lightbox", async ({
		page,
	}) => {
		await loginViaApi(page, USER1);
		await page.goto(`${BASE}/messages/${ROOM_ID}`);
		// 📎 ボタンが見える
		const attachBtn = page.getByRole("button", { name: "添付ファイルを選択" });
		await expect(attachBtn).toBeVisible({ timeout: 15000 });

		// hidden input[type=file] に setInputFiles で画像を入れる
		const fileInput = page.locator(
			'input[type="file"][data-testid="attachment-input"]',
		);
		await fileInput.setInputFiles(FIXTURE_IMAGE);

		// preview チップ (image はサムネイル <img> 描画 / Issue #469)
		const previewList = page.locator('ul[aria-label="添付ファイル一覧"]');
		const previewChip = previewList.locator("li").filter({
			hasText: "sample-image.png",
		});
		await expect(previewChip).toBeVisible({ timeout: 30000 });
		// Issue #469: compose preview 内にサムネイル <img> が出る
		const previewImg = previewList.getByRole("img", {
			name: "sample-image.png",
		});
		await expect(previewImg).toBeVisible();

		// 送信
		await page.getByRole("button", { name: "送信" }).click();

		// 送信後 preview が消えること (compose の img が無くなる)
		await expect(previewList).toHaveCount(0, { timeout: 15000 });

		// bubble 内に <img alt="sample-image.png"> が visible
		const sentImg = page
			.locator('[data-testid="message-bubble"]')
			.getByRole("img", { name: "sample-image.png" })
			.first();
		await expect(sentImg).toBeVisible({ timeout: 30000 });

		// 画像クリックで lightbox 起動
		await sentImg.click();
		await expect(page.getByRole("dialog")).toBeVisible();

		// ESC で閉じる
		await page.keyboard.press("Escape");
		await expect(page.getByRole("dialog")).not.toBeVisible();
	});

	test("ATT-FILE: setInputFiles で PDF を送信 → file chip + ダウンロード anchor", async ({
		page,
	}) => {
		await loginViaApi(page, USER1);
		await page.goto(`${BASE}/messages/${ROOM_ID}`);
		await expect(
			page.getByRole("button", { name: "添付ファイルを選択" }),
		).toBeVisible({ timeout: 15000 });

		const fileInput = page.locator(
			'input[type="file"][data-testid="attachment-input"]',
		);
		await fileInput.setInputFiles(FIXTURE_DOC);

		// preview chip 待ち
		const previewChip = page
			.locator('ul[aria-label="添付ファイル一覧"] li')
			.filter({ hasText: "sample-doc.pdf" });
		await expect(previewChip).toBeVisible({ timeout: 30000 });

		await page.getByRole("button", { name: "送信" }).click();

		// bubble 内に「ダウンロード: sample-doc.pdf (...)」anchor が出る
		const dlLink = page
			.getByRole("link", { name: /ダウンロード: sample-doc\.pdf/ })
			.first();
		await expect(dlLink).toBeVisible({ timeout: 30000 });
		const href = await dlLink.getAttribute("href");
		expect(href).toContain("/dm/");
	});
});
