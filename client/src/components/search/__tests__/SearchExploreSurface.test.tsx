/**
 * Tests for SearchExploreSurface (#806).
 *
 * /explore と /search で共有される chrome の挙動:
 *   - q あり → 検索結果 section + 「『q』 — N 件」 表示
 *   - q なし → 「最新の投稿」 section + h2 visible
 *   - tabs / 説明文 / SearchBox は両方の case で常に表示
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SearchExploreSurface from "@/components/search/SearchExploreSurface";
import type { TweetSummary } from "@/lib/api/tweets";
import type { CurrentUser } from "@/lib/api/users";

// SearchBox is a client component that wires next/navigation; mock to render
// a simple stub so we can assert the surrounding chrome without a full router.
vi.mock("@/components/search/SearchBox", () => ({
	default: ({ initialValue }: { initialValue?: string }) => (
		<div data-testid="search-box" data-value={initialValue ?? ""}>
			SearchBox stub
		</div>
	),
}));

vi.mock("@/components/search/SearchModeTabs", () => ({
	default: ({ mode, query }: { mode: string; query: string }) => (
		<div data-testid="search-mode-tabs" data-mode={mode} data-query={query}>
			SearchModeTabs stub
		</div>
	),
}));

vi.mock("@/components/timeline/TweetCardList", () => ({
	default: ({
		tweets,
		ariaLabel,
		emptyMessage,
	}: {
		tweets: TweetSummary[];
		ariaLabel: string;
		emptyMessage: string;
	}) => (
		<div data-testid="tweet-card-list" aria-label={ariaLabel}>
			{tweets.length === 0 ? emptyMessage : `${tweets.length} tweets`}
		</div>
	),
}));

const SAMPLE_TWEET: TweetSummary = {
	id: 1,
	body: "hello",
	html: "<p>hello</p>",
	char_count: 5,
	author_handle: "alice",
	author_display_name: "Alice",
	author_avatar_url: "",
	tags: [],
	images: [],
	created_at: "2026-05-19T00:00:00Z",
	updated_at: "2026-05-19T00:00:00Z",
	edit_count: 0,
};

const LOGGED_IN_USER = {
	id: "u-1",
	email: "alice@example.com",
	username: "alice",
	full_name: "Alice",
	display_name: "Alice",
	bio: "",
	avatar_url: "",
	header_url: "",
	is_premium: false,
	needs_onboarding: false,
	github_url: "",
	x_url: "",
	zenn_url: "",
	qiita_url: "",
	note_url: "",
	linkedin_url: "",
	preferred_language: "ja",
	auto_translate: false,
	is_private: false,
} as unknown as CurrentUser;

describe("SearchExploreSurface", () => {
	it("q なしのとき: h1 '検索' + tabs + 説明 + box + 「最新の投稿」 h2", () => {
		render(
			<SearchExploreSurface
				query=""
				searchCount={0}
				searchResults={[]}
				latestTweets={[SAMPLE_TWEET]}
				currentUser={null}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "検索", level: 1 }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("heading", { name: "最新の投稿", level: 2 }),
		).toBeInTheDocument();
		expect(screen.getByTestId("search-mode-tabs")).toBeInTheDocument();
		expect(screen.getByTestId("search-box")).toBeInTheDocument();
		expect(
			screen.getByText(/投稿本文、タグ、投稿者で検索します/),
		).toBeInTheDocument();
		// クエリ件数 line は出ない
		expect(screen.queryByText(/件$/)).not.toBeInTheDocument();
	});

	it("logged-in + q ありのとき: 件数行 + 検索結果 section、 「最新の投稿」 は出ない", () => {
		render(
			<SearchExploreSurface
				query="django"
				searchCount={42}
				searchResults={[SAMPLE_TWEET, SAMPLE_TWEET]}
				latestTweets={[]}
				currentUser={LOGGED_IN_USER}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "検索", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getByText(/「django」 — 42 件/)).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "最新の投稿", level: 2 }),
		).not.toBeInTheDocument();
		expect(screen.getByLabelText("「django」の検索結果")).toBeInTheDocument();
	});

	// #811: 検索結果に 「最新 / 注目」 sort tab。
	it("logged-in + q あり: 「最新」 / 「注目」 sort tab + aria-selected", () => {
		render(
			<SearchExploreSurface
				query="django"
				searchCount={3}
				searchResults={[SAMPLE_TWEET]}
				latestTweets={[]}
				currentUser={LOGGED_IN_USER}
				sort="latest"
				basePathname="/search"
			/>,
		);
		expect(
			screen.getByRole("tablist", { name: "検索結果の並び替え" }),
		).toBeInTheDocument();
		const latestTab = screen.getByRole("tab", { name: "最新" });
		const topTab = screen.getByRole("tab", { name: "注目" });
		expect(latestTab).toHaveAttribute("aria-selected", "true");
		expect(topTab).toHaveAttribute("aria-selected", "false");
		expect(latestTab).toHaveAttribute("href", "/search?q=django");
		expect(topTab).toHaveAttribute("href", "/search?q=django&sort=top");
	});

	it("sort='top' で 「注目」 が aria-selected=true", () => {
		render(
			<SearchExploreSurface
				query="django"
				searchCount={3}
				searchResults={[SAMPLE_TWEET]}
				latestTweets={[]}
				currentUser={LOGGED_IN_USER}
				sort="top"
				basePathname="/search"
			/>,
		);
		expect(screen.getByRole("tab", { name: "最新" })).toHaveAttribute(
			"aria-selected",
			"false",
		);
		expect(screen.getByRole("tab", { name: "注目" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	it("basePathname='/explore' で tab href が /explore?q=... を指す", () => {
		render(
			<SearchExploreSurface
				query="rust"
				searchCount={1}
				searchResults={[SAMPLE_TWEET]}
				latestTweets={[]}
				currentUser={LOGGED_IN_USER}
				sort="latest"
				basePathname="/explore"
			/>,
		);
		expect(screen.getByRole("tab", { name: "最新" })).toHaveAttribute(
			"href",
			"/explore?q=rust",
		);
		expect(screen.getByRole("tab", { name: "注目" })).toHaveAttribute(
			"href",
			"/explore?q=rust&sort=top",
		);
	});

	// #808: anon + q あり → 検索結果ではなく 「ログインして検索」 promo を表示。
	it("anon + q ありのとき: promo 表示、 件数行 / 検索結果 section は出ない", () => {
		render(
			<SearchExploreSurface
				query="django"
				searchCount={0}
				searchResults={[]}
				latestTweets={[]}
				currentUser={null}
			/>,
		);
		// chrome は visible
		expect(
			screen.getByRole("heading", { name: "検索", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getByTestId("search-mode-tabs")).toBeInTheDocument();
		expect(screen.getByTestId("search-box")).toBeInTheDocument();
		// promo の h2 + button
		expect(
			screen.getByRole("heading", {
				name: "検索はログインが必要です",
				level: 2,
			}),
		).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "ログイン" })).toHaveAttribute(
			"href",
			expect.stringContaining("/login?next="),
		);
		expect(screen.getByRole("link", { name: "新規登録" })).toHaveAttribute(
			"href",
			"/register",
		);
		// 件数行 / 検索結果 / 「最新の投稿」 は出ない
		expect(screen.queryByText(/「django」 — /)).not.toBeInTheDocument();
		expect(
			screen.queryByLabelText("「django」の検索結果"),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "最新の投稿", level: 2 }),
		).not.toBeInTheDocument();
	});

	it("chrome (h1 + tabs + 説明 + box) は q ありなしに関わらず常に表示", () => {
		const { rerender } = render(
			<SearchExploreSurface
				query=""
				searchCount={0}
				searchResults={[]}
				latestTweets={[]}
				currentUser={null}
			/>,
		);
		// q なし
		expect(
			screen.getByRole("heading", { name: "検索", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getByTestId("search-mode-tabs")).toBeInTheDocument();
		expect(screen.getByTestId("search-box")).toBeInTheDocument();

		// q あり
		rerender(
			<SearchExploreSurface
				query="x"
				searchCount={0}
				searchResults={[]}
				latestTweets={[]}
				currentUser={null}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "検索", level: 1 }),
		).toBeInTheDocument();
		expect(screen.getByTestId("search-mode-tabs")).toBeInTheDocument();
		expect(screen.getByTestId("search-box")).toBeInTheDocument();
	});

	it("SearchBox の initialValue が query と同期する", () => {
		render(
			<SearchExploreSurface
				query="python"
				searchCount={0}
				searchResults={[]}
				latestTweets={[]}
				currentUser={null}
			/>,
		);
		expect(screen.getByTestId("search-box")).toHaveAttribute(
			"data-value",
			"python",
		);
	});
});
