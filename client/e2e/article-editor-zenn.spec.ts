/**
 * #780 ArticleEditor Zenn 流 refine の E2E 検証。
 *
 * Spec: docs/specs/article-editor-zenn-refine-spec.md §4.2
 *
 * 検証:
 *   - E2E-ZENN-1: /articles/new で main col に textarea + 右 sidebar に title input が visible
 *   - E2E-ZENN-2: 本文 markdown 入力 → Preview tab click → preview pane に rendered HTML
 *   - E2E-ZENN-3: keyboard ArrowRight で Preview tab に切替
 *   - E2E-ZENN-4: 「画像を追加」 button が Write tab 中に visible (Preview 中は hidden)
 *   - E2E-ZENN-5: 公開ステータス radio で「公開」 → 「公開する」 button → confirm → toast「公開しました」 → /articles/<slug>
 *
 * 実行:
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *     E2E_LOGIN_EMAIL=test4@example.com E2E_LOGIN_PASSWORD=E5INn9EaBLG7WNPl \
 *     npx playwright test e2e/article-editor-zenn.spec.ts --reporter=line
 *
 * env 詳細: docs/local/e2e-stg.md
 */

import { expect, test } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";
const EMAIL = process.env.E2E_LOGIN_EMAIL ?? "test4@example.com";
const PASSWORD = process.env.E2E_LOGIN_PASSWORD ?? "E5INn9EaBLG7WNPl";

test.describe("#780 ArticleEditor Zenn 流 refine", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(`${BASE}/login`);
		await page.getByLabel(/メール/).fill(EMAIL);
		await page.getByLabel(/パスワード/).fill(PASSWORD);
		await page.getByRole("button", { name: /ログイン/ }).click();
		await page.waitForURL(new RegExp(`^${BASE}/(home/?)?$`), {
			timeout: 15_000,
		});
		await page.goto(`${BASE}/articles/new`);
	});

	test("E2E-ZENN-1: /articles/new で main 本文 + 右 sidebar に title input が見える", async ({
		page,
	}) => {
		// main col の本文 textarea
		await expect(page.getByLabel("本文 (Markdown)")).toBeVisible();
		// 右 sidebar のタイトル input
		await expect(
			page.getByLabel(/タイトル/, { exact: false }).first(),
		).toBeVisible();
		// 公開ステータス fieldset
		await expect(page.getByText("公開ステータス")).toBeVisible();
	});

	test("E2E-ZENN-2: 本文に Markdown 入力 → Preview tab click で rendered heading が表示", async ({
		page,
	}) => {
		await page.getByLabel("本文 (Markdown)").fill("## subhead\n\nbody text");
		await page.getByRole("tab", { name: "Preview" }).click();
		await expect(
			page.getByRole("heading", { name: "subhead", level: 2 }),
		).toBeVisible();
	});

	test("E2E-ZENN-3: ArrowRight キーで Preview tab に切替", async ({ page }) => {
		const writeTab = page.getByRole("tab", { name: "Write" });
		await writeTab.focus();
		await page.keyboard.press("ArrowRight");
		await expect(page.getByRole("tab", { name: "Preview" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("E2E-ZENN-4: 「画像を追加」 button は Write tab で visible、 Preview tab で hidden", async ({
		page,
	}) => {
		// 初期 = Write tab
		await expect(
			page.getByRole("button", { name: "画像を追加" }),
		).toBeVisible();
		// Preview tab に切替
		await page.getByRole("tab", { name: "Preview" }).click();
		await expect(
			page.getByRole("button", { name: "画像を追加" }),
		).not.toBeVisible();
	});

	test("E2E-ZENN-5: 公開 = published で保存 → confirm → toast「公開しました」 → 詳細ページへ遷移", async ({
		page,
	}) => {
		const uniqueTitle = `#780 e2e ${Date.now()}`;
		// タイトル + 本文
		await page
			.getByLabel(/タイトル/, { exact: false })
			.first()
			.fill(uniqueTitle);
		await page
			.getByLabel("本文 (Markdown)")
			.fill("## Section\n\nE2E body for #780 publish path.");
		// 公開ステータスを「公開」 に切替
		await page.getByLabel("公開").check();
		// confirm dialog を accept
		page.once("dialog", (d) => d.accept());
		// 保存 button (status=published なので「公開する」)
		await page.getByRole("button", { name: "公開する" }).click();
		// toast / 遷移
		await expect(page.getByText(/公開しました/)).toBeVisible({
			timeout: 15_000,
		});
		await page.waitForURL(new RegExp(`${BASE}/articles/`), { timeout: 15_000 });
	});
});
