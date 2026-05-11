/**
 * /login submit button が視認可能か検証 (#609).
 *
 * gan-evaluator MEDIUM M3 で発見した「submit button が透明 / 非表示」 を回帰防止。
 * 透明色 / 0 size は本質的に visual だが、 Playwright の visible check + computed
 * background-color check で最低限の回帰防御を入れる。
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

test.describe("/login submit button visibility (#609)", () => {
	test("LOGIN-1: 「ログイン」 submit button が見え、 不透明な背景を持つ", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/login`);

		const button = page.getByRole("button", { name: "ログイン" });
		await expect(button).toBeVisible({ timeout: 15000 });

		// width / height が 0 ではない
		const box = await button.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.width).toBeGreaterThan(0);
		expect(box!.height).toBeGreaterThan(20);

		// background-color が transparent / 透明 でないことを確認 (rgba 4 要素目 > 0)
		const bg = await button.evaluate(
			(el) => window.getComputedStyle(el).backgroundColor,
		);
		// rgb(...) or rgba(..., alpha) のいずれか。 alpha が無い rgb(...) は alpha=1。
		expect(bg).toMatch(/rgba?\([^)]+\)/);
		expect(bg).not.toBe("rgba(0, 0, 0, 0)");
		expect(bg).not.toBe("transparent");

		await ctx.close();
	});
});
