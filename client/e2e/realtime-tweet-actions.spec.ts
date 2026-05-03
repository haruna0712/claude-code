/**
 * #337: リプライ / 引用 / リポストの即時反映 E2E.
 *
 * 検証観点:
 *   1. home の TweetCard で「リポスト」 click → 即時 TL 上部に新 REPOST tweet
 *      が prepend されること (リロード不要)
 *   2. home の TweetCard で「引用」 → PostDialog 投稿 → 即時 TL 上部に新 quote
 *      tweet が prepend されること
 *   3. /tweet/<focal> で「リプライ」 → PostDialog 投稿 → 即時 replies 一覧に
 *      append されること
 *
 * 実行 (stg):
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=test2@gmail.com PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
 *   npx playwright test e2e/realtime-tweet-actions.spec.ts
 */

import { expect, test } from "@playwright/test";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "alice@example.com",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "supersecret12", // pragma: allowlist secret
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "alice",
};

async function login(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	await page.getByLabel(/Email Address|メール/i).fill(email);
	await page.getByPlaceholder(/Password|パスワード/i).fill(password);
	const submit = page.getByRole("button", { name: "Sign In", exact: true });
	if (await submit.isVisible().catch(() => false)) {
		await submit.click();
	} else {
		await page.getByRole("button", { name: "ログイン", exact: true }).click();
	}
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("#337 即時反映 — quote / repost / reply", () => {
	test("home で 引用 → 即時 TL 上部に新 quote tweet が prepend される", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		// TL の最初の引用 button を持つ article (= 通常 article、repost article 除外)
		const article = page
			.locator("article")
			.filter({ has: page.getByRole("button", { name: /^引用/ }) })
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });

		// 投稿前の article 数
		const beforeCount = await page.locator("article").count();

		await article.getByRole("button", { name: /^引用/ }).click();
		const textarea = page.getByRole("textbox", { name: "引用リポストの本文" });
		await expect(textarea).toBeVisible({ timeout: 5_000 });

		const marker = `[#337 quote ${Date.now()}]`;
		await textarea.fill(marker);

		const quoteResp = page.waitForResponse(
			(res) =>
				res.url().includes("/api/v1/tweets/") &&
				res.url().includes("/quote/") &&
				res.request().method() === "POST",
		);
		await page.getByRole("button", { name: "引用する", exact: true }).click();
		const res = await quoteResp;
		expect(res.status()).toBe(201);

		// reload せずに、新 quote tweet が TL 内に出ていること
		await expect(page.getByText(marker, { exact: false })).toBeVisible({
			timeout: 5_000,
		});

		// article 数も増えている (= prepend)
		await expect
			.poll(async () => await page.locator("article").count(), {
				timeout: 5_000,
			})
			.toBeGreaterThan(beforeCount);
	});

	test("home で リポスト → 即時 TL 上部に REPOST tweet が prepend される", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		// reposted=false のリポスト button を持つ article を探す
		const article = page
			.locator("article")
			.filter({ has: page.getByRole("button", { name: "リポスト" }) })
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });
		const beforeCount = await page.locator("article").count();

		const repostBtn = article.getByRole("button", { name: "リポスト" });
		const repostResp = page.waitForResponse(
			(res) =>
				res.url().includes("/api/v1/tweets/") &&
				res.url().includes("/repost/") &&
				res.request().method() === "POST",
		);
		await repostBtn.click();
		const res = await repostResp;
		expect([200, 201]).toContain(res.status());

		// 新 REPOST tweet が prepend されているか (= article 数増加 + RepostBanner
		// 出現)。テキスト「がリポストしました」を含む article の存在で確認。
		await expect
			.poll(async () => await page.locator("article").count(), {
				timeout: 8_000,
			})
			.toBeGreaterThan(beforeCount);
		await expect(page.getByText(/がリポストしました/).first()).toBeVisible({
			timeout: 5_000,
		});
	});

	test("/tweet/<focal> で リプライ → 即時 replies 一覧に append される", async ({
		page,
	}) => {
		await login(page, USER1.email, USER1.password);
		await page.goto("/");

		// home で reply button を持つ article を click → /tweet/<id> へ。
		const article = page
			.locator("article")
			.filter({ has: page.getByRole("button", { name: /^リプライ/ }) })
			.first();
		await expect(article).toBeVisible({ timeout: 15_000 });

		// focal id を URL から取りたいので、article 中の /tweet/<id> link を探す。
		// QuoteEmbed は `/tweet/<id>` link を持つので、reply count badge にも tweet
		// id が必要。ここでは body の link は無いため、href を持つ link で focal
		// id を直接 evaluate で割り出す。代わりに reply button click 後の dialog
		// 経由で focal id を確認する方が手堅い: API URL に含まれる。
		await article.getByRole("button", { name: /^リプライ/ }).click();

		// リプライ Dialog が出るので、その投稿先 focal id を URL 経由ではなく
		// API request URL から拾う。
		const replyTextarea = page.getByRole("textbox", {
			name: "リプライの本文",
		});
		await expect(replyTextarea).toBeVisible({ timeout: 5_000 });
		const marker = `[#337 reply ${Date.now()}]`;
		await replyTextarea.fill(marker);
		const replyResp = page.waitForResponse(
			(res) =>
				res.url().includes("/api/v1/tweets/") &&
				res.url().includes("/reply/") &&
				res.request().method() === "POST",
		);
		await page.getByRole("button", { name: "返信する", exact: true }).click();
		const res = await replyResp;
		expect(res.status()).toBe(201);

		// API URL から focal id を取得 → /tweet/<focalId> に遷移して append 確認。
		const url = res.url();
		const m = url.match(/\/tweets\/(\d+)\/reply\//);
		expect(m, "reply API URL に focal id が含まれる").not.toBeNull();
		const focalId = m![1];

		// home の close 後、別ユーザーの新 reply がリロードなしで focal page で
		// 出るかは別 test。ここでは「自分が直接 /tweet/<focal> を開いた状態で
		// reply を投稿 → 即時下部に append」を main scenario とする。
		await page.goto(`/tweet/${focalId}`);
		await expect(page.getByRole("heading", { level: 2 })).toBeVisible({
			timeout: 5_000,
		});

		// /tweet/<focal> 上で再度 reply を投稿 → リロードなしで append 確認
		const focalReplyBtn = page
			.locator("article")
			.filter({ has: page.getByRole("button", { name: /^リプライ/ }) })
			.first()
			.getByRole("button", { name: /^リプライ/ });
		await focalReplyBtn.click();
		const ta2 = page.getByRole("textbox", { name: "リプライの本文" });
		await expect(ta2).toBeVisible({ timeout: 5_000 });
		const marker2 = `[#337 thread ${Date.now()}]`;
		await ta2.fill(marker2);
		const replyResp2 = page.waitForResponse(
			(res) =>
				res.url().includes("/api/v1/tweets/") &&
				res.url().includes("/reply/") &&
				res.request().method() === "POST",
		);
		await page.getByRole("button", { name: "返信する", exact: true }).click();
		const res2 = await replyResp2;
		expect(res2.status()).toBe(201);

		// reload なしで marker2 が表示される (replies に append)
		await expect(page.getByText(marker2, { exact: false })).toBeVisible({
			timeout: 5_000,
		});
	});
});
