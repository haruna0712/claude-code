/**
 * Phase 2 golden path E2E (P2-21 / Issue #193).
 *
 * Scenario: follow → react → timeline shows new tweet → search.
 *
 * Manual run prerequisites (CI does not exercise this spec yet — it is
 * gated behind a separate workflow that boots the full docker compose
 * stack):
 *
 *     docker compose -f local.yml up -d --build
 *     docker compose -f local.yml exec api python manage.py migrate
 *     # seed two users via /admin/ or fixtures
 *     cd client && npx playwright install chromium
 *     npm run test:e2e -- e2e/phase2.spec.ts
 *
 * The spec assumes two pre-seeded test accounts:
 *   alice@example.com / supersecret12   (handle: alice)
 *   bob@example.com   / supersecret12   (handle: bob)
 * Real execution is wired up by a follow-up infra PR (#194 / Phase 2 stg).
 */

import { expect, test } from "@playwright/test";

const ALICE = {
	email: "alice@example.com",
	password: "supersecret12", // pragma: allowlist secret
	handle: "alice",
};

const BOB = {
	email: "bob@example.com",
	password: "supersecret12", // pragma: allowlist secret
	handle: "bob",
};

async function login(
	page: import("@playwright/test").Page,
	email: string,
	password: string,
) {
	await page.goto("/login");
	await page.getByLabel("メールアドレス").fill(email);
	await page.getByLabel("パスワード").fill(password);
	await page.getByRole("button", { name: /ログイン/ }).click();
	await page.waitForURL(/\/onboarding|\/$/);
}

test.describe("Phase 2 golden path — follow / react / timeline / search", () => {
	test("alice follows bob, reacts to bob's tweet, sees it in timeline, finds via search", async ({
		page,
	}) => {
		// 1. Bob posts a tweet (separate session via API would be cleaner, but
		//    keeping it UI-only here so the same Playwright runner exercises the
		//    full surface).
		await login(page, BOB.email, BOB.password);
		await page.waitForURL("/");
		await page
			.getByRole("textbox", { name: /何を共有/ })
			.fill("phase2 e2e marker python");
		await page.getByRole("button", { name: /投稿/ }).click();

		// Logout via the auth menu (selector pinned by aria-label so layout
		// changes don't silently break the spec).
		await page.getByRole("button", { name: /ログアウト/ }).click();

		// 2. Alice logs in and follows bob.
		await login(page, ALICE.email, ALICE.password);
		await page.goto(`/u/${BOB.handle}`);
		await page.getByRole("button", { name: /^フォローする$/ }).click();
		await expect(
			page.getByRole("button", { name: /フォロー中/ }),
		).toBeVisible();

		// 3. Alice opens bob's tweet and reacts (like).
		await page.getByText("phase2 e2e marker python").first().click();
		await page.getByRole("button", { name: /リアクション/ }).click();
		await page.getByRole("button", { name: /いいね/ }).click();
		await expect(page.getByRole("button", { name: /いいね/ })).toHaveAttribute(
			"aria-pressed",
			"true",
		);

		// 4. Back on home timeline (following tab) we should see bob's tweet.
		await page.goto("/?tab=following");
		await expect(
			page.getByText("phase2 e2e marker python").first(),
		).toBeVisible();

		// 5. Search picks up bob's tweet via keyword + tag operator.
		await page.goto("/search?q=python");
		await expect(
			page.getByText("phase2 e2e marker python").first(),
		).toBeVisible();
	});
});
