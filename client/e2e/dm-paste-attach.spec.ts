/**
 * DM composer Ctrl+V 画像貼り付け UI E2E (#470).
 *
 * setInputFiles ではなく **本物の paste event** を発火して clipboardData に
 * 画像 (sample-image.png の base64) を入れる。Slack/Discord 流の paste 添付。
 *
 * フロー:
 *   1. test2 として login → /messages/<ROOM_ID>
 *   2. textarea にフォーカス → page.evaluate で ClipboardEvent dispatch
 *   3. compose preview に thumbnail <img> が出ること
 *   4. 「送信」 → bubble に <img> が出ること
 */

import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
};
const ROOM_ID = Number(process.env.PLAYWRIGHT_ROOM_ID ?? 1);
const FIXTURE_IMAGE = path.resolve(__dirname, "fixtures/sample-image.png");

test.describe("DM composer Ctrl+V paste (Issue #470)", () => {
	test.beforeEach(() => {
		if (!USER1.email || !USER1.password) {
			throw new Error("PLAYWRIGHT_USER1_EMAIL / PASSWORD required");
		}
	});

	test("PASTE-IMG: clipboard に画像 → composer に thumbnail → 送信 → bubble", async ({
		page,
		context,
	}) => {
		// Login via API (cookies 付与)
		const csrfRes = await context.request.get(`${BASE}/api/v1/auth/csrf/`);
		const csrfHeader = csrfRes.headers()["set-cookie"] ?? "";
		const csrf = /csrftoken=([^;]+)/.exec(csrfHeader)?.[1] ?? "";
		const login = await context.request.post(
			`${BASE}/api/v1/auth/cookie/create/`,
			{
				headers: {
					"Content-Type": "application/json",
					"X-CSRFToken": csrf,
					Referer: `${BASE}/login`,
				},
				data: { email: USER1.email, password: USER1.password },
			},
		);
		expect(login.status()).toBe(200);

		await page.goto(`${BASE}/messages/${ROOM_ID}`);
		const textarea = page.getByLabel("メッセージを入力");
		await expect(textarea).toBeVisible({ timeout: 15000 });

		// Read fixture as base64 → embed into ClipboardEvent
		const imageBytes = fs.readFileSync(FIXTURE_IMAGE);
		const imageB64 = imageBytes.toString("base64");

		// Browser context で File を構築 → ClipboardEvent dispatch
		await textarea.focus();
		await page.evaluate(async (b64) => {
			const bin = atob(b64);
			const len = bin.length;
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
			const file = new File([bytes], "", { type: "image/png" });
			const dt = new DataTransfer();
			dt.items.add(file);
			const ev = new ClipboardEvent("paste", {
				clipboardData: dt,
				bubbles: true,
				cancelable: true,
			});
			document.activeElement?.dispatchEvent(ev);
		}, imageB64);

		// Compose preview に thumbnail <img> (alt は pasted-<ts>.png)
		const previewList = page.locator('ul[aria-label="添付ファイル一覧"]');
		await expect(previewList).toBeVisible({ timeout: 30000 });
		const previewImg = previewList.locator("img").first();
		await expect(previewImg).toBeVisible({ timeout: 30000 });
		const previewAlt = await previewImg.getAttribute("alt");
		expect(previewAlt).toMatch(/^pasted-\d+\.png$/);

		// 送信
		await page.getByRole("button", { name: "送信" }).click();
		await expect(previewList).toHaveCount(0, { timeout: 15000 });

		// Bubble 内に img が出る
		const sentImg = page
			.locator('[data-testid="message-bubble"]')
			.locator("img")
			.last();
		await expect(sentImg).toBeVisible({ timeout: 30000 });
	});
});
