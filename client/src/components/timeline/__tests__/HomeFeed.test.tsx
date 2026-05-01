/**
 * Tests for HomeFeed component (P2-13 / Issue #186).
 * TDD RED phase.
 */

// NOTE: vi.mock calls are hoisted by vitest before any imports, so the order
// below (mocks before the named import of the mocked module) is correct at
// runtime even though ESLint would prefer imports at the top. The mocked
// module import must appear after vi.mock() in source order so that the
// mock factory runs first; eslint-disable is used to acknowledge this.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import HomeFeed from "@/components/timeline/HomeFeed";
import type { TweetSummary } from "@/lib/api/tweets";
// eslint-disable-next-line import/first
import { fetchHomeTimeline, fetchFollowingTimeline } from "@/lib/api/timeline";

// Mock timeline API
vi.mock("@/lib/api/timeline", () => ({
	fetchHomeTimeline: vi.fn(),
	fetchFollowingTimeline: vi.fn(),
}));

// Mock TweetComposer
vi.mock("@/components/tweets/TweetComposer", () => ({
	default: ({ onPosted }: { onPosted?: (tweet: TweetSummary) => void }) => (
		<div data-testid="tweet-composer">
			<button
				onClick={() =>
					onPosted?.({
						id: 999,
						body: "new tweet",
						html: "<p>new tweet</p>",
						char_count: 9,
						author_handle: "me",
						tags: [],
						images: [],
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						edit_count: 0,
					})
				}
			>
				Post
			</button>
		</div>
	),
}));

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush }),
	usePathname: () => "/",
	useSearchParams: () => new URLSearchParams(),
}));

// Mock toast
vi.mock("react-toastify", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

const makeTweet = (
	id: number,
	extra: Partial<TweetSummary> = {},
): TweetSummary => ({
	id,
	body: `tweet ${id}`,
	html: `<p>tweet ${id}</p>`,
	char_count: 7,
	author_handle: "alice",
	author_display_name: "Alice",
	tags: [],
	images: [],
	created_at: "2024-01-15T10:00:00Z",
	updated_at: "2024-01-15T10:00:00Z",
	edit_count: 0,
	...extra,
});

const INITIAL_TWEETS = [makeTweet(1), makeTweet(2), makeTweet(3)];

describe("HomeFeed — initial render", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders TweetComposer", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		expect(screen.getByTestId("tweet-composer")).toBeInTheDocument();
	});

	it("renders TimelineTabs", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		expect(screen.getByRole("tablist")).toBeInTheDocument();
	});

	it("renders initial tweets as TweetCards", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		// Each tweet should be rendered in an article
		const articles = document.querySelectorAll("article");
		expect(articles.length).toBeGreaterThanOrEqual(3);
	});

	it("deduplicates tweets by id", () => {
		const duplicates = [makeTweet(1), makeTweet(1), makeTweet(2)];
		render(<HomeFeed initialTab="recommended" initialTweets={duplicates} />);
		const articles = document.querySelectorAll("article");
		expect(articles.length).toBe(2);
	});

	it("renders 'もっと見る' button", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		expect(
			screen.getByRole("button", { name: /もっと見る/i }),
		).toBeInTheDocument();
	});
});

describe("HomeFeed — tab switching", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchHomeTimeline).mockResolvedValue({
			results: [makeTweet(10), makeTweet(11)],
			cache_hit: true,
		});
		vi.mocked(fetchFollowingTimeline).mockResolvedValue({
			results: [makeTweet(20), makeTweet(21)],
		});
	});

	it("fetches following timeline when following tab is clicked", async () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);

		await userEvent.click(screen.getByRole("tab", { name: /フォロー中/i }));

		await waitFor(() => {
			expect(fetchFollowingTimeline).toHaveBeenCalledWith(20);
		});
	});

	it("switches back to recommended tab and fetches home timeline", async () => {
		render(<HomeFeed initialTab="following" initialTweets={[]} />);

		await userEvent.click(screen.getByRole("tab", { name: /おすすめ/i }));

		await waitFor(() => {
			expect(fetchHomeTimeline).toHaveBeenCalledWith(20);
		});
	});
});

describe("HomeFeed — load more", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchHomeTimeline).mockResolvedValue({
			results: Array.from({ length: 20 }, (_, i) => makeTweet(100 + i)),
			cache_hit: false,
		});
	});

	it("increments limit by 20 on 'もっと見る' click", async () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);

		await userEvent.click(screen.getByRole("button", { name: /もっと見る/i }));

		await waitFor(() => {
			expect(fetchHomeTimeline).toHaveBeenCalledWith(40);
		});
	});

	it("deduplicates merged results after load more", async () => {
		// fetchHomeTimeline returns tweets that overlap with initial
		vi.mocked(fetchHomeTimeline).mockResolvedValue({
			results: [makeTweet(1), makeTweet(4), makeTweet(5)],
			cache_hit: false,
		});

		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);

		await userEvent.click(screen.getByRole("button", { name: /もっと見る/i }));

		await waitFor(() => {
			const articles = document.querySelectorAll("article");
			// 1,2,3 from initial + 4,5 from load more (1 is deduped)
			expect(articles.length).toBe(5);
		});
	});
});

describe("HomeFeed — optimistic prepend", () => {
	it("prepends new tweet to list after TweetComposer posts", async () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);

		const postButton = screen.getByRole("button", { name: /post/i });
		await userEvent.click(postButton);

		await waitFor(() => {
			const articles = document.querySelectorAll("article");
			expect(articles.length).toBe(4); // 3 initial + 1 new
		});
	});
});

describe("HomeFeed — empty state", () => {
	it("shows empty state message when no tweets", () => {
		render(<HomeFeed initialTab="recommended" initialTweets={[]} />);
		expect(screen.getByText(/ツイートがありません/i)).toBeInTheDocument();
	});
});
