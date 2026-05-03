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
import ExpandableBody from "@/components/timeline/ExpandableBody";
import PostDialog from "@/components/tweets/PostDialog";
import RepostButton from "@/components/tweets/RepostButton";
import type { TweetMini, TweetSummary } from "@/lib/api/tweets";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

interface TweetCardProps {
	tweet: TweetSummary;
	/** 1-based position when rendered inside a `role="feed"` container (#201). */
	posinset?: number;
	/** Total feed size; pair with ``posinset`` to satisfy WAI-ARIA feed pattern. */
	setsize?: number;
}

/** #327: 削除済み tweet の tombstone 表示 (article 単位)。 */
function DeletedTombstone({
	posinset,
	setsize,
}: {
	posinset?: number;
	setsize?: number;
}) {
	return (
		<article
			className="flex flex-col gap-1 border-b border-border px-4 py-3 text-sm text-muted-foreground"
			aria-label="削除されたツイート"
			aria-posinset={posinset}
			aria-setsize={setsize}
		>
			<p>このツイートは削除されました。</p>
		</article>
	);
}

/**
 * #327: type=repost の上部に表示する banner. リポストした人 (= tweet.author_handle)
 * を出すだけのシンプルな行。Twitter の「@X がリポスト」相当。
 */
function RepostBanner({
	handle,
	displayName,
}: {
	handle: string;
	displayName?: string;
}) {
	const name = displayName || handle;
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<svg
				className="size-3.5"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
				strokeWidth={1.8}
				aria-hidden="true"
			>
				<path
					strokeLinecap="round"
					strokeLinejoin="round"
					d="M4 7h11l-3-3m3 3l-3 3M20 17H9l3 3m-3-3l3-3"
				/>
			</svg>
			<Link
				href={`/u/${handle}`}
				className="font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
			>
				{name}
			</Link>
			<span>がリポストしました</span>
		</div>
	);
}

/**
 * #327: 引用元 tweet を inline preview として表示 (枠付き縮小カード)。
 * tombstone 時は「このツイートは削除されました」を出す。
 */
function QuoteEmbed({ tweet }: { tweet: TweetMini }) {
	if (tweet.is_deleted) {
		return (
			<div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
				このツイートは削除されました。
			</div>
		);
	}
	const name = tweet.author_display_name || tweet.author_handle;
	return (
		<Link
			href={`/tweet/${tweet.id}`}
			className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors block"
		>
			<div className="mb-1 flex items-center gap-2 text-muted-foreground">
				<span className="font-medium text-foreground">{name}</span>
				<span>@{tweet.author_handle}</span>
			</div>
			<p className="line-clamp-3 whitespace-pre-wrap text-foreground">
				{tweet.body}
			</p>
		</Link>
	);
}

export default function TweetCard({
	tweet,
	posinset,
	setsize,
}: TweetCardProps) {
	const [replyOpen, setReplyOpen] = useState(false);
	const [quoteOpen, setQuoteOpen] = useState(false);

	// #327: 全 hooks は早期 return より前に呼ぶ (React rules of hooks)。
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

	// #327: 削除済み tweet は tombstone で代替 (action button 一切出さない)
	if (tweet.is_deleted) {
		return <DeletedTombstone posinset={posinset} setsize={setsize} />;
	}

	// #327: type=repost は本体を repost_of に差し替えて RepostBanner を被せる。
	// repost_of が tombstone の場合は banner + tombstone を表示。
	if (tweet.type === "repost" && tweet.repost_of) {
		const reposter = tweet.author_display_name ?? tweet.author_handle;
		if (tweet.repost_of.is_deleted) {
			return (
				<article
					className="flex flex-col gap-2 border-b border-border px-4 py-3"
					aria-label={`${reposter} のリポスト (削除済み)`}
					aria-posinset={posinset}
					aria-setsize={setsize}
				>
					<RepostBanner
						handle={tweet.author_handle}
						displayName={tweet.author_display_name}
					/>
					<p className="text-sm text-muted-foreground">
						このツイートは削除されました。
					</p>
				</article>
			);
		}
		// 元 tweet を TweetSummary 風に再構築して TweetCard を再帰呼び出し...
		// ではなく、TweetMini しか無いので簡略表示にする。Phase 4 で repost_of を
		// 完全な summary にする (#TBD)。今は author + body + created_at のみ。
		const original = tweet.repost_of;
		const originalName = original.author_display_name || original.author_handle;
		return (
			<article
				className="flex flex-col gap-2 border-b border-border px-4 py-3 hover:bg-muted/40 transition-colors"
				aria-label={`${reposter} がリポスト: ${originalName} のツイート`}
				aria-posinset={posinset}
				aria-setsize={setsize}
			>
				<RepostBanner
					handle={tweet.author_handle}
					displayName={tweet.author_display_name}
				/>
				<header className="flex items-center gap-3">
					{original.author_avatar_url ? (
						<img
							src={original.author_avatar_url}
							alt=""
							aria-hidden="true"
							className="size-10 shrink-0 rounded-full object-cover"
						/>
					) : (
						<div
							className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
							aria-hidden="true"
						>
							{originalName.charAt(0).toUpperCase()}
						</div>
					)}
					<Link
						href={`/u/${original.author_handle}`}
						className="flex min-w-0 flex-col rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
						aria-label={`${originalName} (@${original.author_handle}) のプロフィール`}
					>
						<span className="font-semibold text-sm text-foreground truncate">
							{originalName}
						</span>
						<span className="text-xs text-muted-foreground">
							@{original.author_handle}
						</span>
					</Link>
				</header>
				<Link
					href={`/tweet/${original.id}`}
					className="rounded text-sm text-foreground whitespace-pre-wrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					{original.body}
				</Link>
			</article>
		);
	}

	const authorName = tweet.author_display_name ?? tweet.author_handle;

	const hasImages = tweet.images.length > 0;
	const hasTags = tweet.tags.length > 0;

	return (
		<article
			// scroll-mt-12 keeps focused articles visible below the sticky tab bar
			// (WCAG 2.2 SC 2.4.11 Focus Not Obscured). Tab bar height is 3rem.
			className="flex flex-col gap-3 border-b border-border px-4 py-3 scroll-mt-12 hover:bg-muted/40 transition-colors"
			aria-label={`${authorName} のツイート`}
			aria-posinset={posinset}
			aria-setsize={setsize}
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

			{/* Tweet body — DOMPurify sanitized HTML, P2-18 expandable. */}
			<ExpandableBody
				html={safeHtml}
				charCount={tweet.char_count}
				className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground"
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

			{/* #327: 引用元 inline embed (type=quote のときのみ表示) */}
			{tweet.type === "quote" && tweet.quote_of && (
				<QuoteEmbed tweet={tweet.quote_of} />
			)}

			{/* Action buttons. Reactions wired in P2-14, repost/quote/reply in P2-15.
			    #327: count badge を 0 以上で表示。tweet.is_deleted のとき disable
			    (実際には is_deleted は早期 return で tombstone なので、ここでは
			    parent (reply_to) の削除状態でも button は出す方針。 */}
			<footer className="mt-1 flex items-center gap-4">
				<button
					type="button"
					aria-label={
						tweet.reply_count ? `リプライ ${tweet.reply_count} 件` : "リプライ"
					}
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
					{tweet.reply_count ? (
						<span aria-hidden="true" className="font-semibold">
							{tweet.reply_count}
						</span>
					) : null}
				</button>

				<div className="flex items-center gap-1">
					<RepostButton tweetId={tweet.id} />
					{tweet.repost_count ? (
						<span
							className="text-xs text-muted-foreground"
							aria-label={`リポスト ${tweet.repost_count} 件`}
						>
							{tweet.repost_count}
						</span>
					) : null}
				</div>

				<button
					type="button"
					aria-label={
						tweet.quote_count ? `引用 ${tweet.quote_count} 件` : "引用リポスト"
					}
					onClick={() => setQuoteOpen(true)}
					className="flex items-center gap-1 min-h-[32px] px-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
				>
					<span aria-hidden="true">”</span>
					<span>引用</span>
					{tweet.quote_count ? (
						<span aria-hidden="true" className="font-semibold">
							{tweet.quote_count}
						</span>
					) : null}
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
