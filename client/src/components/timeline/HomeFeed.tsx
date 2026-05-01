// HomeFeed: ログイン後の `/` で表示するタイムライン (composer + tweet list)。
// 初回 SSR で取得した tweets を hydrate し、composer から投稿された新ツイートは
// 楽観的に list 先頭に prepend する (P2-13 ホーム TL UI / Twitter 風)。
"use client";

import { useState } from "react";

import TweetComposer from "@/components/tweets/TweetComposer";
import TweetCard from "@/components/timeline/TweetCard";
import type { TweetSummary } from "@/lib/api/tweets";

interface HomeFeedProps {
	initialTweets: TweetSummary[];
}

export default function HomeFeed({ initialTweets }: HomeFeedProps) {
	const [tweets, setTweets] = useState<TweetSummary[]>(initialTweets);

	const handlePosted = (tweet: TweetSummary) => {
		setTweets((prev) => [tweet, ...prev]);
	};

	return (
		<main className="mx-auto max-w-2xl px-4 py-6">
			<header className="mb-6">
				<h1 className="text-2xl font-bold text-veryBlack dark:text-babyPowder">
					ホーム
				</h1>
				<p className="text-sm text-veryBlack/60 dark:text-babyPowder/60">
					フォロー中 70% + 全体 30% のミックスタイムライン
				</p>
			</header>

			<section
				aria-label="新規ツイート投稿"
				className="mb-6 rounded-lg border border-veryBlack/10 dark:border-babyPowder/10 bg-card p-4"
			>
				<TweetComposer onPosted={handlePosted} autoFocus={false} />
			</section>

			<section aria-label="タイムライン">
				{tweets.length === 0 ? (
					<p className="rounded-lg border border-dashed border-veryBlack/15 dark:border-babyPowder/15 p-8 text-center text-sm text-veryBlack/60 dark:text-babyPowder/60">
						まだツイートがありません。最初の一投をどうぞ。
					</p>
				) : (
					<ul className="space-y-3">
						{tweets.map((tweet) => (
							<li key={tweet.id}>
								<TweetCard tweet={tweet} />
							</li>
						))}
					</ul>
				)}
			</section>
		</main>
	);
}
