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

		// fixture thread (id=1)。 stg で削除されたら status check で fast-fail
		// するので「 404 で hydration error 0 件 → vacuously green」 を防ぐ
		// (code-reviewer MEDIUM 対応)。
		const response = await page.goto(`${BASE}/threads/1`);
		expect(
			response?.status(),
			"fixture thread /threads/1 が消えている可能性。 stg で id 再確認",
		).toBeLessThan(400);
		// ThreadView 描画 + hydration 完了を待つ。
		// 固定 waitForTimeout だと slow stg cold start で race するので、
		// network idle と heading 表示の AND で hydration step を確実に拾う。
		await page
			.getByRole("heading", { level: 1 })
			.first()
			.waitFor({ timeout: 15000 });
		await page.waitForLoadState("networkidle", { timeout: 15000 });

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

		// fixture board "django"。 同様に status check で fast-fail。
		const response = await page.goto(`${BASE}/boards/django`);
		expect(
			response?.status(),
			"fixture board /boards/django が消えている可能性。 stg で slug 再確認",
		).toBeLessThan(400);
		await page
			.getByRole("heading", { level: 1 })
			.first()
			.waitFor({ timeout: 15000 });
		await page.waitForLoadState("networkidle", { timeout: 15000 });

		expect(
			hydrationErrors,
			`Expected 0 hydration errors, got ${hydrationErrors.length}:\n${hydrationErrors.join("\n")}`,
		).toHaveLength(0);

		await ctx.close();
	});
});
