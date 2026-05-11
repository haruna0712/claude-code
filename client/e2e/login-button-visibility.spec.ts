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

	test("LOGIN-2: Google ログイン button のコントラスト比が WCAG AA を満たす (#615)", async ({
		browser,
	}) => {
		const ctx = await browser.newContext();
		const page = await ctx.newPage();
		await page.goto(`${BASE}/login`);

		const button = page.getByRole("button", { name: /Google でログイン/ });
		await expect(button).toBeVisible({ timeout: 15000 });

		const { bg, fg } = await button.evaluate((el) => {
			const cs = window.getComputedStyle(el);
			return { bg: cs.backgroundColor, fg: cs.color };
		});

		// rgb(...) を [r,g,b] に。 contrast 計算用。
		const parse = (s: string): [number, number, number] => {
			const m = /(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(s);
			if (!m) throw new Error(`Cannot parse color: ${s}`);
			return [Number(m[1]), Number(m[2]), Number(m[3])];
		};
		const luminance = (rgb: [number, number, number]) => {
			const [r, g, b] = rgb.map((v) => {
				const c = v / 255;
				return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const l1 = luminance(parse(bg));
		const l2 = luminance(parse(fg));
		const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
		// WCAG AA normal text = 4.5:1 以上
		expect(ratio).toBeGreaterThanOrEqual(4.5);

		await ctx.close();
	});
});
