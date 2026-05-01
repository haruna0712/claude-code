"use client";

/**
 * TweetCard — renders a single tweet in the timeline (P2-13 / Issue #186).
 *
 * Security: tweet.html is sanitized via isomorphic-dompurify before being
 * passed to dangerouslySetInnerHTML. This is CRITICAL defense-in-depth —
 * the backend sanitizes on write, but the client must not trust that blindly.
 */

import Link from "next/link";
import React, { useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import ReactionBar from "@/components/reactions/ReactionBar";
import PostDialog from "@/components/tweets/PostDialog";
import RepostButton from "@/components/tweets/RepostButton";
import type { TweetSummary } from "@/lib/api/tweets";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

interface TweetCardProps {
	tweet: TweetSummary;
}

export default function TweetCard({ tweet }: TweetCardProps) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [quoteOpen, setQuoteOpen] = useState(false);

	// CRITICAL: sanitize HTML before rendering — strips <script>, event handlers,
	// javascript: hrefs, <iframe>, <style>, and other XSS vectors.
	const safeHtml = useMemo(
		() =>
			DOMPurify.sanitize(tweet.html, {
				USE_PROFILES: { html: true },
			}),
		[tweet.html],
	);

	const relativeTime = useMemo(
		() => formatRelativeTime(tweet.created_at),
		[tweet.created_at],
	);

	// Absolute timestamp for screen readers; the visible "2h" alone reads
	// poorly (e.g. JP SR speaks "ニエイチ"). Always pair via aria-label.
	const absoluteTime = useMemo(
		() =>
			new Date(tweet.created_at).toLocaleString("ja-JP", {
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			}),
		[tweet.created_at],
	);

	const authorName = tweet.author_display_name ?? tweet.author_handle;

	const hasImages = tweet.images.length > 0;
	const hasTags = tweet.tags.length > 0;

	return (
		<article
			// scroll-mt-12 keeps focused articles visible below the sticky tab bar
			// (WCAG 2.2 SC 2.4.11 Focus Not Obscured). Tab bar height is 3rem.
			className="flex flex-col gap-3 border-b border-border px-4 py-3 scroll-mt-12 hover:bg-muted/40 transition-colors"
			aria-label={`${authorName} のツイート`}
		>
			{/* Author row */}
			<header className="flex items-center gap-3">
				{tweet.author_avatar_url ? (
					<img
						src={tweet.author_avatar_url}
						alt=""
						aria-hidden="true"
						className="size-10 shrink-0 rounded-full object-cover"
					/>
				) : (
					<div
						data-testid="avatar-placeholder"
						className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
						aria-hidden="true"
					>
						{authorName.charAt(0).toUpperCase()}
					</div>
				)}

				<div className="flex min-w-0 flex-col">
					<span className="font-semibold text-sm text-foreground truncate">
						{authorName}
					</span>
					<span className="text-xs text-muted-foreground">
						@{tweet.author_handle}
					</span>
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-2">
					{tweet.edit_count > 0 && (
						<span
							aria-label="この投稿は編集されています"
							className="text-xs text-muted-foreground border border-muted-foreground/30 rounded px-1 py-0.5"
						>
							編集済
						</span>
					)}
					<time
						dateTime={tweet.created_at}
						aria-label={absoluteTime}
						className="text-xs text-muted-foreground"
					>
						{relativeTime}
					</time>
				</div>
			</header>

			{/* Tweet body — DOMPurify sanitized HTML */}
			<div
				className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground"
				dangerouslySetInnerHTML={{ __html: safeHtml }}
			/>

			{/* Images grid (up to 4 images) */}
			{hasImages && (
				<div
					data-testid="tweet-images"
					className={`grid gap-1 ${tweet.images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
				>
					{tweet.images.slice(0, 4).map((img, idx) => (
						<img
							key={img.image_url}
							src={img.image_url}
							// Until Phase 1 backfill ships per-image alt_text, fall back to a
							// descriptive label so SR users know an image exists. A11Y.md §2.1.
							alt={`${authorName} のツイートの添付画像 ${idx + 1}`}
							width={img.width}
							height={img.height}
							className="w-full rounded-md object-cover max-h-64"
						/>
					))}
				</div>
			)}

			{/* Tag chips */}
			{hasTags && (
				<div data-testid="tweet-tags" className="flex flex-wrap gap-1">
					{tweet.tags.map((tag) => (
						<Link
							key={tag}
							href={`/tag/${tag}`}
							className="text-xs text-lime-600 dark:text-lime-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
							aria-label={`#${tag}`}
						>
							#{tag}
						</Link>
					))}
				</div>
			)}

			{/* Action buttons. Reactions wired in P2-14, repost/quote/reply in P2-15. */}
			<footer className="mt-1 flex items-center gap-4">
				<button
					type="button"
					aria-label="リプライ"
					onClick={() => setReplyOpen(true)}
					className="flex items-center gap-1 min-h-[32px] px-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
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
							d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
						/>
					</svg>
					<span>リプライ</span>
				</button>

				<RepostButton tweetId={tweet.id} />

				<button
					type="button"
					aria-label="引用リポスト"
					onClick={() => setQuoteOpen(true)}
					className="flex items-center gap-1 min-h-[32px] px-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
				>
					<span aria-hidden="true">”</span>
					<span>引用</span>
				</button>

				<ReactionBar tweetId={tweet.id} />
			</footer>

			<PostDialog
				tweetId={tweet.id}
				mode="reply"
				open={replyOpen}
				onOpenChange={setReplyOpen}
			/>
			<PostDialog
				tweetId={tweet.id}
				mode="quote"
				open={quoteOpen}
				onOpenChange={setQuoteOpen}
			/>
		</article>
	);
}
