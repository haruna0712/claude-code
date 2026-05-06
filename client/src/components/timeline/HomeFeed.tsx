"use client";

/**
 * HomeFeed — main timeline feed component (P2-13 / Issue #186).
 *
 * Renders TimelineTabs and a list of TweetCards. Supports tab switching and
 * "もっと見る" load-more (limit increment, not cursor pagination —
 * backend cursor pagination tracked in P2-08).
 *
 * #396: inline TweetComposer は撤去。投稿は LeftNavbar の + ボタンから開く
 * `ComposeTweetDialog` 経由で行う。投稿成功時は dialog が `router.refresh()`
 * を呼ぶため、ホームに居れば SSR 再フェッチで最新 TL に切り替わる。
 */

import { useCallback, useRef, useState } from "react";
import { toast } from "react-toastify";
import TimelineTabs, {
	type TabValue,
} from "@/components/timeline/TimelineTabs";
import TweetCard from "@/components/timeline/TweetCard";
import { fetchHomeTimeline, fetchFollowingTimeline } from "@/lib/api/timeline";
import type { TweetSummary } from "@/lib/api/tweets";

const INITIAL_LIMIT = 20;
const LIMIT_INCREMENT = 20;
// Client-side cap so a misbehaving client cannot ask the backend for an
// unbounded page. Real cursor pagination ships in the P2-08 follow-up.
const MAX_LIMIT = 200;

interface HomeFeedProps {
	initialTab: TabValue;
	initialTweets: TweetSummary[];
	currentUserHandle?: string;
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

export default function HomeFeed({
	initialTab,
	initialTweets,
	currentUserHandle,
}: HomeFeedProps) {
	const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
	const [tweets, setTweets] = useState<TweetSummary[]>(
		dedupById(initialTweets),
	);
	const [limit, setLimit] = useState(INITIAL_LIMIT);
	const [isLoading, setIsLoading] = useState(false);
	const [liveMessage, setLiveMessage] = useState("");
	// Generation counter — each fetch claims a number; if a newer fetch starts,
	// older in-flight responses no-op when they finally resolve. Prevents stale
	// results from overwriting a fresh tab switch.
	const fetchGeneration = useRef(0);

	const handleTabChange = useCallback(async (tab: TabValue) => {
		const myGen = ++fetchGeneration.current;
		setActiveTab(tab);
		setLimit(INITIAL_LIMIT);
		setIsLoading(true);
		try {
			const data =
				tab === "recommended"
					? await fetchHomeTimeline(INITIAL_LIMIT)
					: await fetchFollowingTimeline(INITIAL_LIMIT);

			if (myGen !== fetchGeneration.current) return;
			setTweets(dedupById(data.results));
		} catch {
			if (myGen !== fetchGeneration.current) return;
			toast.error("タイムラインの取得に失敗しました");
		} finally {
			if (myGen === fetchGeneration.current) setIsLoading(false);
		}
	}, []);

	const handleLoadMore = useCallback(async () => {
		const nextLimit = Math.min(limit + LIMIT_INCREMENT, MAX_LIMIT);
		if (nextLimit === limit) return;
		const myGen = ++fetchGeneration.current;
		setLimit(nextLimit);
		setIsLoading(true);
		try {
			const data =
				activeTab === "recommended"
					? await fetchHomeTimeline(nextLimit)
					: await fetchFollowingTimeline(nextLimit);

			if (myGen !== fetchGeneration.current) return;
			setTweets((prev) => dedupById([...prev, ...data.results]));
		} catch {
			if (myGen !== fetchGeneration.current) return;
			toast.error("ツイートの追加読み込みに失敗しました");
		} finally {
			if (myGen === fetchGeneration.current) setIsLoading(false);
		}
	}, [activeTab, limit]);

	// #337: TweetCard 配下 (PostDialog reply/quote, RepostButton) で投稿された
	// tweet を TL 上部に prepend する。reply は home TL に出さない (#334) ので
	// type が REPLY のときは何もしない (count badge の楽観 +1 は TweetCard 内で
	// 完結しているので、ここで何もしなくても親の見た目は更新済み)。
	const handleDescendantPosted = useCallback((tweet: TweetSummary) => {
		if (tweet.type === "reply") return;
		setTweets((prev) => dedupById([tweet, ...prev]));
		setLiveMessage(
			tweet.type === "repost"
				? "リポストしました"
				: tweet.type === "quote"
					? "引用リポストしました"
					: "新しいツイートを投稿しました",
		);
	}, []);

	const handleTimelineItemRemoved = useCallback((tweetId: number) => {
		setTweets((prev) => prev.filter((tweet) => tweet.id !== tweetId));
	}, []);

	return (
		<div className="flex flex-col gap-0">
			{/* SR-only live region for optimistic prepend announcement */}
			<div role="status" aria-live="polite" className="sr-only">
				{liveMessage}
			</div>

			{/* Tab switcher */}
			<div className="sticky top-0 z-10 border-b border-border bg-background">
				<TimelineTabs activeTab={activeTab} onTabChange={handleTabChange} />
			</div>

			{/* Tweet list */}
			<section aria-label="タイムライン">
				{tweets.length === 0 && !isLoading ? (
					<div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
						<p className="text-sm">ツイートがありません</p>
					</div>
				) : (
					<div role="feed" aria-label="タイムライン" aria-busy={isLoading}>
						{tweets.map((tweet, idx) => (
							<TweetCard
								key={tweet.id}
								tweet={tweet}
								posinset={idx + 1}
								setsize={tweets.length}
								onDescendantPosted={handleDescendantPosted}
								currentUserHandle={currentUserHandle}
								onTimelineItemRemoved={handleTimelineItemRemoved}
							/>
						))}
					</div>
				)}

				{/* Load more */}
				<div className="flex justify-center py-4">
					<button
						type="button"
						aria-label="もっと見る"
						onClick={handleLoadMore}
						disabled={isLoading}
						className="rounded-full border border-border px-6 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
					>
						{isLoading ? "読み込み中..." : "もっと見る"}
					</button>
				</div>
			</section>
		</div>
	);
}
