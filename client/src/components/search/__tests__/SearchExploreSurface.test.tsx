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

	it("q ありのとき: 件数行 + 検索結果 section、 「最新の投稿」 は出ない", () => {
		render(
			<SearchExploreSurface
				query="django"
				searchCount={42}
				searchResults={[SAMPLE_TWEET, SAMPLE_TWEET]}
				latestTweets={[]}
				currentUser={null}
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
