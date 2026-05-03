"use client";

/**
 * TweetCardList (#298 / #301).
 *
 * Server Component から受け取った tweet 配列を Client な TweetCard で render する
 * 薄いラッパ。/u/[handle] / /tweet/[id] / /tag/[name] / /explore など、
 * 既存の plain `<a>` link で render していたページが共通でリアクション / RT
 * / 「もっと見る」展開を享受できるようにする。
 *
 * Server からは JSON-serializable な TweetSummary 配列を渡すだけで済む。
 * ARIA feed pattern に揃えるため `role="feed"` + posinset/setsize を付与する
 * (HomeFeed と同じ pattern)。
 */

import TweetCard from "@/components/timeline/TweetCard";
import type { TweetSummary } from "@/lib/api/tweets";

interface TweetCardListProps {
	tweets: TweetSummary[];
	/**
	 * a11y label。/u/<handle> なら "<display> のツイート" 等、文脈に応じた
	 * 説明を渡す (HomeFeed は "ホームタイムライン" 等)。
	 */
	ariaLabel: string;
	/**
	 * 空配列のときに表示する文言。default は "ツイートがありません。"。
	 */
	emptyMessage?: string;
}

export default function TweetCardList({
	tweets,
	ariaLabel,
	emptyMessage = "ツイートがありません。",
}: TweetCardListProps) {
	if (tweets.length === 0) {
		return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
	}
	return (
		<section
			role="feed"
			aria-label={ariaLabel}
			aria-busy="false"
			className="flex flex-col gap-3"
		>
			{tweets.map((tweet, index) => (
				<TweetCard
					key={tweet.id}
					tweet={tweet}
					posinset={index + 1}
					setsize={tweets.length}
				/>
			))}
		</section>
	);
}
