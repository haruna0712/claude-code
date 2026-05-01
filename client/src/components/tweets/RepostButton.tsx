"use client";

/**
 * RepostButton — toggle repost on a tweet (P2-15 / Issue #188).
 *
 * Optimistic UX:
 *   - Click while not reposted → immediately mark active, POST /repost/
 *   - Click while reposted → immediately mark inactive, DELETE /repost/
 *   - On API error: rollback + toast
 */

import { useState } from "react";
import { toast } from "react-toastify";

import { repostTweet, unrepostTweet } from "@/lib/api/repost";

interface RepostButtonProps {
	tweetId: number;
	initialReposted?: boolean;
}

export default function RepostButton({
	tweetId,
	initialReposted = false,
}: RepostButtonProps) {
	const [reposted, setReposted] = useState(initialReposted);
	const [busy, setBusy] = useState(false);

	const handleClick = async () => {
		if (busy) return;
		const previous = reposted;
		setBusy(true);
		setReposted(!previous);

		try {
			if (previous) {
				await unrepostTweet(tweetId);
			} else {
				await repostTweet(tweetId);
			}
		} catch {
			setReposted(previous);
			toast.error("リポストを更新できませんでした");
		} finally {
			setBusy(false);
		}
	};

	return (
		<button
			type="button"
			aria-label={reposted ? "リポストを取消" : "リポスト"}
			aria-pressed={reposted}
			disabled={busy}
			onClick={handleClick}
			className={`flex items-center gap-1 min-h-[32px] px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded ${
				reposted
					? "text-lime-600 dark:text-lime-400"
					: "text-muted-foreground hover:text-foreground"
			} disabled:opacity-50`}
		>
			<svg
				className="size-4"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.5}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 3M21 7.5H7.5"
				/>
			</svg>
			<span>リポスト</span>
		</button>
	);
}
