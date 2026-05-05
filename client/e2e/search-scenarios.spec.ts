/**
 * Search scenarios.
 *
 * Spec source: docs/specs/search-scenarios.md (SRC-XX)
 * Run examples:  docs/specs/search-e2e-commands.md
 *
 *   PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
 *   PLAYWRIGHT_USER1_EMAIL=<email> PLAYWRIGHT_USER1_PASSWORD=<password> PLAYWRIGHT_USER1_HANDLE=<handle> \
 *   PLAYWRIGHT_USER2_EMAIL=<email> PLAYWRIGHT_USER2_PASSWORD=<password> PLAYWRIGHT_USER2_HANDLE=<handle> \
 *   npx playwright test e2e/search-scenarios.spec.ts --workers=1 --grep "SRC-01"
 *
 * 検証戦略:
 *   - 各 test は USER1 が固有 marker を含む tweet を API で投稿し、その
 *     marker を q に渡して結果に含まれるかを検証する。stg 共有データ汚染を
 *     避けるため、結果の総件数は固定せず marker 含有のみアサート。
 *   - 演算子 (tag/from/since/until/type/has) は parser 単体テスト
 *     (apps/search/tests/test_parser.py) でカバー済み。本 spec はサーバ層
 *     〜 UI までの繋ぎを smoke で確認する。
 */

import {
	expect,
	request,
	type APIRequestContext,
	type Page,
	test,
} from "@playwright/test";

const API_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8080";

const USER1 = {
	email: process.env.PLAYWRIGHT_USER1_EMAIL ?? "",
	password: process.env.PLAYWRIGHT_USER1_PASSWORD ?? "",
	handle: process.env.PLAYWRIGHT_USER1_HANDLE ?? "",
};

function requireCredentials() {
	for (const [name, value] of Object.entries({
		PLAYWRIGHT_USER1_EMAIL: USER1.email,
		PLAYWRIGHT_USER1_PASSWORD: USER1.password,
		PLAYWRIGHT_USER1_HANDLE: USER1.handle,
	})) {
		if (!value) throw new Error(`${name} is required`);
	}
}

interface AuthedContext {
	context: APIRequestContext;
	csrf: string;
}

async function apiAuthed(
	email: string,
	password: string,
): Promise<AuthedContext> {
	const context = await request.newContext({ baseURL: API_BASE });
	await context.get("/api/v1/auth/csrf/");
	const initial = await context.storageState();
	const initialCsrf =
		initial.cookies.find((c) => c.name === "csrftoken")?.value ?? "";

	const login = await context.post("/api/v1/auth/cookie/create/", {
		headers: {
			"Content-Type": "application/json",
			"X-CSRFToken": initialCsrf,
			Referer: `${API_BASE}/login`,
		},
		data: { email, password },
	});
	expect(login.status(), `login failed for ${email}`).toBe(200);

	const after = await context.storageState();
	const csrf =
		after.cookies.find((c) => c.name === "csrftoken")?.value ?? initialCsrf;
	return { context, csrf };
}

async function postTweetAs(user: typeof USER1, body: string): Promise<number> {
	const api = await apiAuthed(user.email, user.password);
	try {
		const res = await api.context.post("/api/v1/tweets/", {
			headers: {
				"Content-Type": "application/json",
				"X-CSRFToken": api.csrf,
				Referer: `${API_BASE}/`,
			},
			data: { body },
		});
		expect(res.status()).toBe(201);
		return (await res.json()).id as number;
	} finally {
		await api.context.dispose();
	}
}

async function deleteTweetAs(
	user: typeof USER1,
	tweetId: number,
): Promise<void> {
	const api = await apiAuthed(user.email, user.password);
	try {
		await api.context.delete(`/api/v1/tweets/${tweetId}/`, {
			headers: { "X-CSRFToken": api.csrf, Referer: `${API_BASE}/` },
		});
	} finally {
		await api.context.dispose();
	}
}

interface SearchResponse {
	query: string;
	count: number;
	results: { id: number; body: string; tags: string[]; type: string }[];
}

async function fetchSearchAnon(
	q: string,
	limit?: number,
): Promise<SearchResponse> {
	const ctx = await request.newContext({ baseURL: API_BASE });
	try {
		const params = new URLSearchParams({ q });
		if (limit !== undefined) params.set("limit", String(limit));
		const res = await ctx.get(`/api/v1/search/?${params.toString()}`);
		expect(res.status()).toBe(200);
		return (await res.json()) as SearchResponse;
	} finally {
		await ctx.dispose();
	}
}

function uniqueMarker(tag: string): string {
	const rand = Math.random().toString(36).slice(2, 10);
	return `e2esearch-${tag}-${Date.now()}-${rand}`;
}

test.beforeAll(() => requireCredentials());

// =============================================================================
// API-driven scenarios
// =============================================================================

test.describe("Search API (per-spec marker)", () => {
	test("SRC-01: 単純なキーワードで自分の marker tweet がヒットする", async () => {
		const marker = uniqueMarker("kw");
		const id = await postTweetAs(USER1, `${marker} python is fun`);
		try {
			const data = await fetchSearchAnon(marker);
			expect(data.count).toBeGreaterThanOrEqual(1);
			expect(data.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-02: 大文字小文字を区別しない (marker を大文字で検索)", async () => {
		const marker = uniqueMarker("case");
		const id = await postTweetAs(USER1, `${marker} ruby`);
		try {
			const data = await fetchSearchAnon(marker.toUpperCase());
			expect(data.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-03: 空クエリは空結果", async () => {
		const data1 = await fetchSearchAnon("");
		expect(data1.count).toBe(0);
		expect(data1.results).toEqual([]);
		const data2 = await fetchSearchAnon("   ");
		expect(data2.count).toBe(0);
	});

	test("SRC-04: クエリ前後の空白は trim される (query は strip 後を echo)", async () => {
		const marker = uniqueMarker("trim");
		const id = await postTweetAs(USER1, `${marker} go`);
		try {
			const data = await fetchSearchAnon(`  ${marker}  `);
			expect(data.query).toBe(marker);
			expect(data.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-07: from:<handle> で投稿者絞り込み", async () => {
		const marker = uniqueMarker("from");
		const id = await postTweetAs(USER1, `${marker} from-test`);
		try {
			const data = await fetchSearchAnon(`${marker} from:${USER1.handle}`);
			expect(data.results.find((r) => r.id === id)).toBeTruthy();
			// 大文字小文字を意識しない (iexact)
			const upper = await fetchSearchAnon(
				`${marker} from:${USER1.handle.toUpperCase()}`,
			);
			expect(upper.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-09: 不正な日付は silent drop (例外にならない、500/400 にならない)", async () => {
		const data1 = await fetchSearchAnon("since:2026-13-99");
		expect(data1.count).toBe(0);
		const data2 = await fetchSearchAnon("since:yesterday");
		expect(data2.count).toBe(0);
	});

	test("SRC-10: type: で tweet 種別絞り込み", async () => {
		const marker = uniqueMarker("type");
		const id = await postTweetAs(USER1, `${marker} body`);
		try {
			const orig = await fetchSearchAnon(`${marker} type:original`);
			expect(orig.results.find((r) => r.id === id)).toBeTruthy();
			const replyOnly = await fetchSearchAnon(`${marker} type:reply`);
			expect(replyOnly.results.find((r) => r.id === id)).toBeFalsy();
			const invalid = await fetchSearchAnon(`${marker} type:foo`);
			// type:foo は drop され keyword だけが効く → marker 含有なら hit
			expect(invalid.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-14: 未知演算子は keyword に流れる (literal substring 一致)", async () => {
		const marker = `e2esearch-foo:bar-${Date.now()}`;
		const id = await postTweetAs(USER1, `${marker} text`);
		try {
			// `foo:bar` の literal が body に含まれるなら、未知演算子 foo:... が
			// 落ちずに keyword に積まれて icontains で一致する
			const data = await fetchSearchAnon(marker);
			expect(data.results.find((r) => r.id === id)).toBeTruthy();
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-15: limit クランプ (500 → 100 以下)", async () => {
		const data = await fetchSearchAnon("type:original", 500);
		expect(data.count).toBeLessThanOrEqual(100);
		expect(data.results.length).toBeLessThanOrEqual(100);
	});

	test("SRC-16: 不正 limit は default フォールバック (500 を返さない)", async () => {
		const ctx = await request.newContext({ baseURL: API_BASE });
		try {
			const res = await ctx.get(
				`/api/v1/search/?q=${encodeURIComponent("type:original")}&limit=abc`,
			);
			expect(res.status()).toBe(200);
		} finally {
			await ctx.dispose();
		}
	});

	test("SRC-17: 結果は新着順 (id 降順 tiebreaker)", async () => {
		const marker = uniqueMarker("order");
		const idA = await postTweetAs(USER1, `${marker} A`);
		const idB = await postTweetAs(USER1, `${marker} B`); // newer
		try {
			const data = await fetchSearchAnon(marker);
			const ids = data.results.map((r) => r.id);
			const aIdx = ids.indexOf(idA);
			const bIdx = ids.indexOf(idB);
			expect(aIdx).toBeGreaterThanOrEqual(0);
			expect(bIdx).toBeGreaterThanOrEqual(0);
			// 新しい方 (idB) が先に来る
			expect(bIdx).toBeLessThan(aIdx);
		} finally {
			await deleteTweetAs(USER1, idA);
			await deleteTweetAs(USER1, idB);
		}
	});

	test("SRC-18: 削除済み tweet は結果に出ない", async () => {
		const marker = uniqueMarker("del");
		const id = await postTweetAs(USER1, `${marker} body`);
		const before = await fetchSearchAnon(marker);
		expect(before.results.find((r) => r.id === id)).toBeTruthy();
		await deleteTweetAs(USER1, id);
		const after = await fetchSearchAnon(marker);
		expect(after.results.find((r) => r.id === id)).toBeFalsy();
	});

	test("SRC-20: 未ログインで検索できる (AllowAny)", async () => {
		const ctx = await request.newContext({ baseURL: API_BASE });
		try {
			const res = await ctx.get("/api/v1/search/?q=type:original");
			expect(res.status()).toBe(200);
		} finally {
			await ctx.dispose();
		}
	});
});

// =============================================================================
// UI scenarios (/search ページ)
// =============================================================================

async function gotoSearch(page: Page, q?: string) {
	const url = q ? `/search?q=${encodeURIComponent(q)}` : "/search";
	await page.goto(url);
}

test.describe("Search UI (/search)", () => {
	test("SRC-21: SearchBox 空文字 submit は navigate しない", async ({
		page,
	}) => {
		await gotoSearch(page);
		const input = page.locator('input[name="q"]');
		await input.fill("");
		await page.getByRole("button", { name: "検索", exact: true }).click();
		await expect(page).toHaveURL(/\/search$/);
	});

	test("SRC-22: SearchBox は URL 経由で初期値を受け取る", async ({ page }) => {
		await gotoSearch(page, "python tag:django");
		const input = page.locator('input[name="q"]');
		await expect(input).toHaveValue("python tag:django");
	});

	test("SRC-01 UI: 結果ありで /search?q=<marker> が 200 で render され、結果カードに本文が出る (#372 回帰防止)", async ({
		page,
	}) => {
		const marker = uniqueMarker("ui");
		const id = await postTweetAs(USER1, `${marker} ui-render-check`);
		try {
			await gotoSearch(page, marker);
			// SSR 500 (#372) 回帰防止: 結果セクションが見える
			await expect(page.getByRole("region", { name: "検索結果" })).toBeVisible({
				timeout: 15_000,
			});
			// TweetCardList 経由の article がいる
			await expect(page.locator("article").first()).toBeVisible({
				timeout: 10_000,
			});
		} finally {
			await deleteTweetAs(USER1, id);
		}
	});

	test("SRC-03 UI: 空クエリでは結果セクションが出ず CTA だけ", async ({
		page,
	}) => {
		await gotoSearch(page);
		await expect(
			page.getByText("上のボックスにキーワードを入れて検索してください。"),
		).toBeVisible();
	});
});

// =============================================================================
// Navbar HeaderSearchBox (#377)
// =============================================================================

test.describe("Search UI (Navbar HeaderSearchBox)", () => {
	test("SRC-26: 任意ページの Navbar から submit すると /search?q= に遷移する", async ({
		page,
	}) => {
		await page.goto("/explore");
		const navbar = page.locator("nav").first();
		const navbarSearch = navbar.getByRole("search", {
			name: "ツイート検索",
		});
		await expect(navbarSearch).toBeVisible({ timeout: 10_000 });
		await navbarSearch.getByRole("searchbox").fill("python");
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/search\?q=python/);
		// /search ページ内 SearchBox にも初期値として伝播
		await expect(
			page
				.locator('main input[name="q"]')
				.or(page.locator('section input[name="q"]')),
		).toHaveValue("python");
	});

	test("SRC-27: Navbar HeaderSearchBox の空文字 submit は navigate しない", async ({
		page,
	}) => {
		await page.goto("/explore");
		const navbar = page.locator("nav").first();
		const navbarSearch = navbar.getByRole("search", {
			name: "ツイート検索",
		});
		await expect(navbarSearch).toBeVisible();
		await navbarSearch.getByRole("searchbox").focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/\/explore$/);
	});

	test("SRC-28: Navbar HeaderSearchBox は URL の q を初期値として受け取らない", async ({
		page,
	}) => {
		await gotoSearch(page, "python");
		const navbar = page.locator("nav").first();
		const navbarSearchInput = navbar.getByRole("searchbox", {
			name: "検索クエリ",
		});
		await expect(navbarSearchInput).toBeVisible();
		await expect(navbarSearchInput).toHaveValue("");
	});

	test("SRC-29: Navbar HeaderSearchBox は未ログインでも表示・動作する", async ({
		browser,
	}) => {
		// 専用 anonymous context
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto("/explore");
			const navbar = page.locator("nav").first();
			const navbarSearch = navbar.getByRole("search", {
				name: "ツイート検索",
			});
			await expect(navbarSearch).toBeVisible({ timeout: 10_000 });
			await navbarSearch.getByRole("searchbox").fill("python");
			await page.keyboard.press("Enter");
			await expect(page).toHaveURL(/\/search\?q=python/);
		} finally {
			await context.close();
		}
	});
});
