"use client";

/**
 * ConversationReplies — /tweet/[id] の focal + replies を render する client wrapper.
 *
 * #337: focal で reply 投稿後にリロードしないと表示されない問題を解消する。
 * server component (page.tsx) は initial fetch だけを行い、その結果を初期値
 * として渡す。focal の reply 投稿は onDescendantPosted 経由で bubble up
 * するので、ここで `replies` state に append する。
 *
 * focal 自体の TweetCard は border-l 強調を付けて表示する (Twitter conversation
 * view 慣習)。
 */

import { useCallback, useState } from "react";

import TweetCardList from "@/components/timeline/TweetCardList";
import type { TweetSummary } from "@/lib/api/tweets";

interface ConversationRepliesProps {
	focal: TweetSummary;
	initialReplies: TweetSummary[];
	currentUserHandle?: string;
}

function dedupById(tweets: TweetSummary[]): TweetSummary[] {
	const seen = new Set<number>();
	return tweets.filter((t) => {
		if (seen.has(t.id)) return false;
		seen.add(t.id);
		return true;
	});
}

export default function ConversationReplies({
	focal,
	initialReplies,
	currentUserHandle,
}: ConversationRepliesProps) {
	const [replies, setReplies] = useState<TweetSummary[]>(
		dedupById(initialReplies),
	);
	const [liveMessage, setLiveMessage] = useState("");

	// focal の reply 投稿時に呼ばれる。reply 以外 (quote / repost) は home TL の
	// 話なのでここでは扱わず、focal が /tweet/<focal_id> page から離れるとして
	// 無視する (新 quote tweet を append しても conversation view では文脈が
	// ずれる)。Twitter も同じ挙動で、quote は home に出る。
	const handleDescendantPosted = useCallback(
		(tweet: TweetSummary) => {
			if (tweet.type !== "reply") return;
			// focal の直下 reply のみ追加 (chain が深い reply は append しない)。
			// reply_to は TweetMini (id を含む) で来る。
			if (tweet.reply_to?.id !== focal.id) return;
			setReplies((prev) => dedupById([...prev, tweet]));
			setLiveMessage("リプライを投稿しました");
		},
		[focal.id],
	);

	return (
		<>
			<div role="status" aria-live="polite" className="sr-only">
				{liveMessage}
			</div>

			<section
				aria-label="このツイート"
				className="border-l-2 border-baby_blue pl-2 my-1"
			>
				<TweetCardList
					tweets={[focal]}
					ariaLabel="ツイート詳細"
					onDescendantPosted={handleDescendantPosted}
					currentUserHandle={currentUserHandle}
				/>
			</section>

			{replies.length > 0 ? (
				<section aria-label="リプライ" className="mt-2">
					<h2 className="px-4 py-2 text-sm font-semibold text-muted-foreground">
						リプライ ({replies.length})
					</h2>
					<TweetCardList
						tweets={replies}
						ariaLabel="リプライ一覧"
						onDescendantPosted={handleDescendantPosted}
						currentUserHandle={currentUserHandle}
					/>
				</section>
			) : (
				<p className="px-4 py-6 text-sm text-muted-foreground">
					まだリプライはありません。
				</p>
			)}
		</>
	);
}
