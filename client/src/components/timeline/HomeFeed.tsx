"use client";

/**
 * HomeFeed — main timeline feed component (P2-13 / Issue #186).
 *
 * Renders TweetComposer, TimelineTabs, and a list of TweetCards.
 * Supports optimistic prepend on new tweet, tab switching, and
 * "もっと見る" load-more (limit increment, not cursor pagination —
 * backend cursor pagination tracked in P2-08).
 */

import { useCallback, useState } from "react";
import TweetComposer from "@/components/tweets/TweetComposer";
import TimelineTabs, {
	type TabValue,
} from "@/components/timeline/TimelineTabs";
import TweetCard from "@/components/timeline/TweetCard";
import { fetchHomeTimeline, fetchFollowingTimeline } from "@/lib/api/timeline";
import type { TweetSummary } from "@/lib/api/tweets";

const INITIAL_LIMIT = 20;
const LIMIT_INCREMENT = 20;

interface HomeFeedProps {
	initialTab: TabValue;
	initialTweets: TweetSummary[];
}

/**
 * Deduplicate tweets by id, preserving order and keeping the first occurrence.
 */
function dedupById(tweets: TweetSummary[]): TweetSummary[] {
	const seen = new Set<number>();
	return tweets.filter((t) => {
		if (seen.has(t.id)) return false;
		seen.add(t.id);
		return true;
	});
}

export default function HomeFeed({ initialTab, initialTweets }: HomeFeedProps) {
	const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
	const [tweets, setTweets] = useState<TweetSummary[]>(
		dedupById(initialTweets),
	);
	const [limit, setLimit] = useState(INITIAL_LIMIT);
	const [isLoading, setIsLoading] = useState(false);

	const fetchTweets = useCallback(async (tab: TabValue, nextLimit: number) => {
		setIsLoading(true);
		try {
			const data =
				tab === "recommended"
					? await fetchHomeTimeline(nextLimit)
					: await fetchFollowingTimeline(nextLimit);

			setTweets((prev) => dedupById([...prev, ...data.results]));
		} finally {
			setIsLoading(false);
		}
	}, []);

	const handleTabChange = useCallback(async (tab: TabValue) => {
		setActiveTab(tab);
		setLimit(INITIAL_LIMIT);
		setIsLoading(true);
		try {
			const data =
				tab === "recommended"
					? await fetchHomeTimeline(INITIAL_LIMIT)
					: await fetchFollowingTimeline(INITIAL_LIMIT);

			setTweets(dedupById(data.results));
		} finally {
			setIsLoading(false);
		}
	}, []);

	const handleLoadMore = useCallback(async () => {
		const nextLimit = limit + LIMIT_INCREMENT;
		setLimit(nextLimit);
		await fetchTweets(activeTab, nextLimit);
	}, [activeTab, limit, fetchTweets]);

	const handlePosted = useCallback((tweet: TweetSummary) => {
		setTweets((prev) => dedupById([tweet, ...prev]));
	}, []);

	return (
		<div className="flex flex-col gap-0">
			{/* Tweet composer */}
			<div className="px-4 py-3 border-b border-border">
				<TweetComposer onPosted={handlePosted} />
			</div>

			{/* Tab switcher */}
			<div className="sticky top-0 z-10 bg-background border-b border-border">
				<TimelineTabs activeTab={activeTab} onTabChange={handleTabChange} />
			</div>

			{/* Tweet list */}
			<section aria-label="タイムライン">
				{tweets.length === 0 && !isLoading ? (
					<div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<p className="text-sm">ツイートがありません</p>
					</div>
				) : (
					<ul role="list" aria-label="ツイート一覧">
						{tweets.map((tweet) => (
							<li key={tweet.id}>
								<TweetCard tweet={tweet} />
							</li>
						))}
					</ul>
				)}

				{/* Load more */}
				<div className="flex justify-center py-4">
					<button
						type="button"
						aria-label="もっと見る"
						onClick={handleLoadMore}
						disabled={isLoading}
						className="px-6 py-2 rounded-full border border-border text-sm text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{isLoading ? "読み込み中..." : "もっと見る"}
					</button>
				</div>
			</section>
		</div>
	);
}
