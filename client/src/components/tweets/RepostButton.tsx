"use client";

/**
 * RepostButton — repost / unrepost / quote の menu trigger (Issue #342, X 準拠).
 *
 * 旧仕様 (#188): 即時 toggle button だったが、Twitter UX に合わせて
 * Click → DropdownMenu で「リポスト / 引用」を選ばせる形に変更。
 *
 * State machine: docs/specs/repost-quote-state-machine.md §3 を参照.
 *   not_reposted → menu: [リポスト] [引用]
 *   reposted     → menu: [リポストを取り消す] [引用]
 *
 * 引用は本 component では PostDialog を直接 open せず、`onQuoteRequest`
 * callback で親 (TweetCard) に依頼する。これは parentTweet preview のために
 * PostDialog 自体は TweetCard で持つ必要があり、ここで重複生成しないため。
 */

import { useState } from "react";
import { toast } from "react-toastify";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { repostTweet, unrepostTweet } from "@/lib/api/repost";
import { fetchTweet, type TweetSummary } from "@/lib/api/tweets";

interface RepostButtonProps {
	tweetId: number;
	initialReposted?: boolean;
	/**
	 * #337: repost 成功時に新規 REPOST tweet (TweetSummary) を返す。
	 * 上位 (HomeFeed 等) で TL に prepend して即時反映するために使う。
	 */
	onPosted?: (tweet: TweetSummary) => void;
	/**
	 * #342: menu「引用」 を選択したときに親に通知。親 (TweetCard) は
	 * PostDialog mode="quote" を open する。
	 */
	onQuoteRequest?: () => void;
}

export default function RepostButton({
	tweetId,
	initialReposted = false,
	onPosted,
	onQuoteRequest,
}: RepostButtonProps) {
	const [reposted, setReposted] = useState(initialReposted);
	const [busy, setBusy] = useState(false);
	// a11y CRITICAL-2 (PR #343 review): toast は visible UX のみで SR には届きにくい。
	// state 変化を sr-only な polite live region で announce する。
	const [statusMsg, setStatusMsg] = useState("");

	const handleRepost = async () => {
		if (busy) return;
		setBusy(true);
		setReposted(true);
		try {
			const result = await repostTweet(tweetId);
			setStatusMsg("リポストしました");
			if (onPosted) {
				try {
					const full = await fetchTweet(result.id);
					onPosted(full);
				} catch {
					toast.warn(
						"リポストは完了しましたが、画面更新に失敗しました。リロードしてください。",
					);
				}
			}
		} catch {
			setReposted(false);
			toast.error("リポストを更新できませんでした");
		} finally {
			setBusy(false);
		}
	};

	const handleUnrepost = async () => {
		if (busy) return;
		setBusy(true);
		setReposted(false);
		try {
			await unrepostTweet(tweetId);
			setStatusMsg("リポストを取り消しました");
		} catch {
			setReposted(true);
			toast.error("リポストを取り消せませんでした");
		} finally {
			setBusy(false);
		}
	};

	return (
		<DropdownMenu>
			{/* a11y CRITICAL-2: 状態変化を sr-only polite live region で announce */}
			<span role="status" aria-live="polite" className="sr-only">
				{statusMsg}
			</span>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					// a11y CRITICAL-1: aria-pressed は menu trigger に不適切 (Radix が
					// 自動付与する aria-haspopup="menu"/aria-expanded と意味衝突)。
					// 状態は accessible name に直接含める (X 公式日本語版に準拠)。
					aria-label={reposted ? "リポスト済み" : "リポスト"}
					disabled={busy}
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
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="min-w-[10rem]">
				{reposted ? (
					<DropdownMenuItem
						onSelect={(e) => {
							e.preventDefault();
							handleUnrepost();
						}}
					>
						リポストを取り消す
					</DropdownMenuItem>
				) : (
					<DropdownMenuItem
						onSelect={(e) => {
							e.preventDefault();
							handleRepost();
						}}
					>
						リポスト
					</DropdownMenuItem>
				)}
				<DropdownMenuItem
					onSelect={(e) => {
						e.preventDefault();
						// #349: Dialog open を menu close 完了後の次フレームに逃がす。
						// 同フレームで両方走らせると Radix DropdownMenu の click event が
						// PostDialog の onPointerDownOutside に届き Dialog が即時 close
						// される race condition があるため (二重防御: TweetCard 側でも
						// menuitem を closest 除外している)。
						setTimeout(() => onQuoteRequest?.(), 0);
					}}
				>
					引用
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
