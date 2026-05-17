/**
 * #742 /threads/<id> hydration mismatch fix E2E.
 *
 * Spec: docs/specs/threads-hydration-fix-spec.md §3.2
 *
 * 改修前 (stg 2026-05-17 実測): React #425 × 8 + #418 + #423 = 10 件
 * 改修後 (本 PR merge 後 stg): 0 件
 *
 * 原因: ThreadPostItem.formatDateTime / ThreadRow.formatDateTime が
 *       `new Date(iso).toLocaleString("ja-JP", ...)` を timezone 指定なしで
 *       call していたため、 SSR (Docker UTC) と CSR (browser JST) で異なる
 *       文字列が出ていた。
 *
 * 修正: lib/datetime.ts の formatJstDateTime に集約、 timeZone="Asia/Tokyo" 強制。
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     npx playwright test e2e/threads-hydration.spec.ts --reporter=line
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

// React hydration / runtime errors のうち本 issue が対象とする 3 codes。
// React production build は error code のみ表示 (full message なし)。
// reactjs.org/docs/error-decoder.html?invariant=<n> を参照。
const HYDRATION_ERROR_CODES = ["#425", "#418", "#423"];

function isHydrationError(text: string): boolean {
	return HYDRATION_ERROR_CODES.some((code) => text.includes(code));
}

test.describe("#742 /threads/<id> hydration fix", () => {
	test("HYDRATION-1: /threads/1 で React hydration error が 0 件", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();

		const hydrationErrors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error" && isHydrationError(msg.text())) {
				hydrationErrors.push(msg.text());
			}
		});

		await page.goto(`${BASE}/threads/1`);
		// ThreadView の post 描画 + hydration 完了を待つ
		await page
			.getByRole("heading", { level: 1 })
			.first()
			.waitFor({ timeout: 15000 });
		// hydration error は client-side 描画途中に fire するので少し待つ
		await page.waitForTimeout(2000);

		expect(
			hydrationErrors,
			`Expected 0 hydration errors, got ${hydrationErrors.length}:\n${hydrationErrors.join("\n")}`,
		).toHaveLength(0);

		await ctx.close();
	});

	test("HYDRATION-2: /boards/django で ThreadRow render 中も hydration error 0 件", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();

		const hydrationErrors: string[] = [];
		page.on("console", (msg) => {
			if (msg.type() === "error" && isHydrationError(msg.text())) {
				hydrationErrors.push(msg.text());
			}
		});

		await page.goto(`${BASE}/boards/django`);
		await page
			.getByRole("heading", { level: 1 })
			.first()
			.waitFor({ timeout: 15000 });
		await page.waitForTimeout(2000);

		expect(
			hydrationErrors,
			`Expected 0 hydration errors, got ${hydrationErrors.length}:\n${hydrationErrors.join("\n")}`,
		).toHaveLength(0);

		await ctx.close();
	});
});
