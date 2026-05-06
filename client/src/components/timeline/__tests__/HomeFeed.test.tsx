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

// #396: TweetComposer はホームから撤去された (LeftNavbar の + ボタン経由)。
// HomeFeed は composer を直接 import しなくなったため mock 不要。

// Mock next/navigation
const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, replace: mockReplace }),
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

	it("does not render an inline TweetComposer (#396 — moved to LeftNavbar dialog)", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		// アクセシブル名で識別される投稿フォームがホーム上に存在しないこと。
		expect(screen.queryByTestId("tweet-composer")).not.toBeInTheDocument();
		expect(
			screen.queryByRole("textbox", { name: /投稿|tweet/i }),
		).not.toBeInTheDocument();
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

// #396: 旧「TweetComposer 経由の楽観 prepend」は HomeFeed の責務から外れた。
// 投稿は ComposeTweetDialog 側で router.refresh() を呼ぶため、ホーム TL は SSR
// 再フェッチで更新される。HomeFeed 自身の prepend は TweetCard 配下からの
// repost / quote (handleDescendantPosted) 経路のみ残っている。

describe("HomeFeed — empty state", () => {
	it("shows empty state message when no tweets", () => {
		render(<HomeFeed initialTab="recommended" initialTweets={[]} />);
		expect(screen.getByText(/ツイートがありません/i)).toBeInTheDocument();
	});
});

describe("HomeFeed — review fixes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("notifies user via toast when timeline fetch fails (not silent)", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(fetchFollowingTimeline).mockRejectedValueOnce(
			new Error("network down"),
		);

		render(<HomeFeed initialTab="recommended" initialTweets={[]} />);
		await userEvent.click(screen.getByRole("tab", { name: /フォロー中/i }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("タイムラインの取得に失敗"),
			);
		});
	});

	it("notifies user via toast when load-more fails", async () => {
		const { toast } = await import("react-toastify");
		vi.mocked(fetchHomeTimeline).mockRejectedValueOnce(new Error("500"));

		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		await userEvent.click(screen.getByRole("button", { name: /もっと見る/i }));

		await waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith(
				expect.stringContaining("追加読み込みに失敗"),
			);
		});
	});

	it("ignores stale tab fetch result when newer tab switch arrives", async () => {
		// Fast tab → following returns slow with stale data;
		// then user clicks back to recommended which returns fast.
		// The stale "following" response must NOT overwrite the recommended list.
		let resolveSlow: (v: { results: TweetSummary[] }) => void = () => {};
		vi.mocked(fetchFollowingTimeline).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveSlow = resolve;
				}),
		);
		vi.mocked(fetchHomeTimeline).mockResolvedValue({
			results: [makeTweet(99)],
			cache_hit: true,
		});

		render(<HomeFeed initialTab="recommended" initialTweets={[]} />);

		// 1. switch to following (slow, pending)
		await userEvent.click(screen.getByRole("tab", { name: /フォロー中/i }));
		// 2. immediately switch back to recommended (fast resolve)
		await userEvent.click(screen.getByRole("tab", { name: /おすすめ/i }));
		await waitFor(() => {
			expect(fetchHomeTimeline).toHaveBeenCalled();
		});

		// 3. now resolve the stale following request
		resolveSlow({ results: [makeTweet(500), makeTweet(501)] });

		await waitFor(() => {
			const articles = document.querySelectorAll("article");
			// Only the fresh recommended result should be visible (id 99),
			// not the stale following ids 500/501.
			expect(articles.length).toBe(1);
		});
	});

	it("renders the tweet list inside a role='feed' container with aria-busy / aria-label (#201)", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		const feed = screen.getByRole("feed");
		expect(feed.getAttribute("aria-label")).toBe("タイムライン");
		expect(feed.getAttribute("aria-busy")).toBe("false");
	});

	it("each article in the feed has aria-posinset / aria-setsize (#201)", () => {
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		const articles = document.querySelectorAll("article");
		articles.forEach((a, idx) => {
			expect(a.getAttribute("aria-posinset")).toBe(String(idx + 1));
			expect(a.getAttribute("aria-setsize")).toBe(String(articles.length));
		});
	});

	it("renders an aria-live region for descendant repost / quote announcements", () => {
		// #396: TweetComposer 経由の prepend は撤去。aria-live region 自体は
		// TweetCard 配下 (RepostButton / 引用) からの楽観 prepend のために残す。
		render(
			<HomeFeed initialTab="recommended" initialTweets={INITIAL_TWEETS} />,
		);
		const live = document.querySelector('[role="status"][aria-live="polite"]');
		expect(live).toBeTruthy();
		expect(live?.textContent).toBe("");
	});
});
