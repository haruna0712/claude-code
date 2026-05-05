"use client";

/**
 * TweetCard — renders a single tweet in the timeline (P2-13 / Issue #186).
 *
 * Security: tweet.html is sanitized via isomorphic-dompurify before being
 * passed to dangerouslySetInnerHTML. This is CRITICAL defense-in-depth —
 * the backend sanitizes on write, but the client must not trust that blindly.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useCallback, useMemo, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import ReactionBar from "@/components/reactions/ReactionBar";
import ExpandableBody from "@/components/timeline/ExpandableBody";
import PostDialog from "@/components/tweets/PostDialog";
import RepostButton from "@/components/tweets/RepostButton";
import {
	deleteTweet,
	type TweetMini,
	type TweetSummary,
} from "@/lib/api/tweets";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/timeline/formatTime";

interface TweetCardProps {
	tweet: TweetSummary;
	/** 1-based position when rendered inside a `role="feed"` container (#201). */
	posinset?: number;
	/** Total feed size; pair with ``posinset`` to satisfy WAI-ARIA feed pattern. */
	setsize?: number;
	/**
	 * #337: 子 dialog (PostDialog reply / quote) と RepostButton で新規 tweet が
	 * 投稿された際、上位 (HomeFeed / ConversationReplies) に bubble up する。
	 * 上位は受け取った tweet.type を見て prepend / append を判断する。
	 */
	onDescendantPosted?: (tweet: TweetSummary) => void;
	/** Login viewer handle. Used to remove this row when it is my own repost. */
	currentUserHandle?: string;
	/** Called when this timeline row should disappear after unrepost. */
	onTimelineItemRemoved?: (tweetId: number) => void;
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

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export default function TweetCard({
	tweet,
	posinset,
	setsize,
	onDescendantPosted,
	currentUserHandle,
	onTimelineItemRemoved,
}: TweetCardProps) {
	const router = useRouter();
	const [replyOpen, setReplyOpen] = useState(false);
	const [quoteOpen, setQuoteOpen] = useState(false);
	const [deleteBusy, setDeleteBusy] = useState(false);
	const [locallyDeleted, setLocallyDeleted] = useState(false);
	const isRepost = tweet.type === "repost" && tweet.repost_of;
	const displayTweet = isRepost ? tweet.repost_of! : tweet;
	const reposterName = tweet.author_display_name ?? tweet.author_handle;
	const canDelete =
		!isRepost &&
		!!currentUserHandle &&
		displayTweet.author_handle === currentUserHandle;

	// #340: card 全体クリックで /tweet/<id> に遷移 (X 慣習)。
	// 内部 link / button は伝播を止めて従来動作。テキスト drag-select も保護。
	// repost article は repost_of の id へ飛ばす (banner 上ではなく元 tweet 詳細)。
	const targetId = displayTweet.id;
	const navigateToDetail = useCallback(
		(e: React.MouseEvent | React.KeyboardEvent) => {
			// e.target は EventTarget 型で Text node / 純 EventTarget の場合 closest を
			// 持たないため、Element に narrow してから判定する。
			if (!(e.target instanceof Element)) return;
			// #349: Radix DropdownMenu の menuitem は role="menuitem" (button では
			// ない) で Portal 経由で render されても click が article に bubble して
			// くる (実機で /tweet/<id> へ誤遷移する事象を確認)。menuitem 系 + Radix
			// Portal 内 (data-radix-popper-content-wrapper) + Dialog 内の event を
			// 包括的に除外する。
			if (
				e.target.closest(
					"a, button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='dialog'], textarea, input, [data-radix-popper-content-wrapper]",
				)
			)
				return;
			if (typeof window !== "undefined") {
				const sel = window.getSelection?.();
				if (sel && sel.toString().length > 0) return;
			}
			router.push(`/tweet/${targetId}`);
		},
		[router, targetId],
	);
	const onCardKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" || e.key === " ") {
				if (!(e.target instanceof Element)) return;
				// 内部の interactive element に focus がある場合はそちらの動作優先
				if (
					e.target.closest(
						"a, button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='dialog'], textarea, input, [data-radix-popper-content-wrapper]",
					)
				)
					return;
				e.preventDefault();
				navigateToDetail(e);
			}
		},
		[navigateToDetail],
	);
	const handleDelete = useCallback(async () => {
		if (deleteBusy) return;
		setDeleteBusy(true);
		try {
			await deleteTweet(tweet.id);
			setLocallyDeleted(true);
			onTimelineItemRemoved?.(tweet.id);
			toast.success("ツイートを削除しました");
		} catch {
			toast.error("ツイートを削除できませんでした");
			setDeleteBusy(false);
		}
	}, [deleteBusy, onTimelineItemRemoved, tweet.id]);

	// #334: reply / quote 投稿成功時に楽観的に親 count badge を +1 する。
	// PostDialog onPosted コールバック → ここで state を更新し、再レンダーで
	// footer の count が即時反映される。リロード不要。
	const [replyCountOptimistic, setReplyCountOptimistic] = useState(
		displayTweet.reply_count ?? 0,
	);
	const [quoteCountOptimistic, setQuoteCountOptimistic] = useState(
		displayTweet.quote_count ?? 0,
	);
	const [repostCountOptimistic, setRepostCountOptimistic] = useState(
		displayTweet.repost_count ?? 0,
	);

	// #327: 全 hooks は早期 return より前に呼ぶ (React rules of hooks)。
	// CRITICAL: sanitize HTML before rendering — strips <script>, event handlers,
	// javascript: hrefs, <iframe>, <style>, and other XSS vectors.
	const safeHtml = useMemo(
		() =>
			DOMPurify.sanitize(displayTweet.html ?? escapeHtml(displayTweet.body), {
				USE_PROFILES: { html: true },
			}),
		[displayTweet.body, displayTweet.html],
	);

	const relativeTime = useMemo(
		() => formatRelativeTime(displayTweet.created_at),
		[displayTweet.created_at],
	);

	// Absolute timestamp for screen readers; the visible "2h" alone reads
	// poorly (e.g. JP SR speaks "ニエイチ"). Always pair via aria-label.
	const absoluteTime = useMemo(
		() =>
			new Date(displayTweet.created_at).toLocaleString("ja-JP", {
				year: "numeric",
				month: "long",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			}),
		[displayTweet.created_at],
	);

	// #327: 削除済み tweet は tombstone で代替 (action button 一切出さない)
	if (locallyDeleted) {
		return null;
	}

	if (tweet.is_deleted) {
		return <DeletedTombstone posinset={posinset} setsize={setsize} />;
	}

	if (displayTweet.is_deleted) {
		return (
			<article
				className="flex flex-col gap-2 border-b border-border px-4 py-3"
				aria-label={`${reposterName} のリポスト (削除済み)`}
				aria-posinset={posinset}
				aria-setsize={setsize}
			>
				{isRepost ? (
					<RepostBanner
						handle={tweet.author_handle}
						displayName={tweet.author_display_name}
					/>
				) : null}
				<p className="text-sm text-muted-foreground">
					このツイートは削除されました。
				</p>
			</article>
		);
	}

	const authorName =
		displayTweet.author_display_name ?? displayTweet.author_handle;

	const images = displayTweet.images ?? [];
	const tags = displayTweet.tags ?? [];
	const hasImages = images.length > 0;
	const hasTags = tags.length > 0;

	return (
		<article
			// scroll-mt-12 keeps focused articles visible below the sticky tab bar
			// (WCAG 2.2 SC 2.4.11 Focus Not Obscured). Tab bar height is 3rem.
			className="flex cursor-pointer flex-col gap-3 border-b border-border px-4 py-3 scroll-mt-12 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			aria-label={
				isRepost
					? `${reposterName} がリポスト: ${authorName} のツイート — クリックで詳細`
					: `${authorName} のツイート — クリックで詳細`
			}
			aria-posinset={posinset}
			aria-setsize={setsize}
			tabIndex={0}
			onClick={navigateToDetail}
			onKeyDown={onCardKeyDown}
		>
			{isRepost ? (
				<RepostBanner
					handle={tweet.author_handle}
					displayName={tweet.author_display_name}
				/>
			) : null}
			{/* Author row */}
			<header className="flex items-center gap-3">
				{displayTweet.author_avatar_url ? (
					<img
						src={displayTweet.author_avatar_url}
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

				{/* #320: 作者名 / @handle を /u/<handle> への Link 化。Tweet 本文の
				    click 領域 (詳細遷移) と分離するため、Link は header 内のみ。
				    keyboard でも Tab 1 hop で focus + Enter で profile に飛べる。 */}
				<Link
					href={`/u/${displayTweet.author_handle}`}
					className="flex min-w-0 flex-col rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:underline"
					aria-label={`${authorName} (@${displayTweet.author_handle}) のプロフィール`}
				>
					<span className="font-semibold text-sm text-foreground truncate">
						{authorName}
					</span>
					<span className="text-xs text-muted-foreground">
						@{displayTweet.author_handle}
					</span>
				</Link>

				<div className="ml-auto flex shrink-0 items-center gap-2">
					{(displayTweet.edit_count ?? 0) > 0 && (
						<span
							aria-label="この投稿は編集されています"
							className="text-xs text-muted-foreground border border-muted-foreground/30 rounded px-1 py-0.5"
						>
							編集済
						</span>
					)}
					<time
						dateTime={displayTweet.created_at}
						aria-label={absoluteTime}
						className="text-xs text-muted-foreground"
					>
						{relativeTime}
					</time>
					{canDelete ? (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									aria-label="ツイートのその他メニュー"
									disabled={deleteBusy}
									className="inline-flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
								>
									<MoreHorizontal className="size-4" aria-hidden="true" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-[10rem]">
								<DropdownMenuItem
									className="text-destructive focus:text-destructive"
									disabled={deleteBusy}
									onSelect={(event) => {
										event.preventDefault();
										handleDelete();
									}}
								>
									<Trash2 className="mr-2 size-4" aria-hidden="true" />
									削除
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</div>
			</header>

			{/* Tweet body — DOMPurify sanitized HTML, P2-18 expandable. */}
			<ExpandableBody
				html={safeHtml}
				charCount={displayTweet.char_count ?? displayTweet.body.length}
				className="prose prose-sm dark:prose-invert max-w-none text-sm text-foreground"
			/>

			{/* Images grid (up to 4 images) */}
			{hasImages && (
				<div
					data-testid="tweet-images"
					className={`grid gap-1 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
				>
					{images.slice(0, 4).map((img, idx) => (
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
					{tags.map((tag) => (
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
			{displayTweet.type === "quote" && displayTweet.quote_of && (
				<QuoteEmbed tweet={displayTweet.quote_of} />
			)}

			{/* Action buttons. Reactions wired in P2-14, repost/quote/reply in P2-15.
			    #327: count badge を 0 以上で表示。tweet.is_deleted のとき disable
			    (実際には is_deleted は早期 return で tombstone なので、ここでは
			    parent (reply_to) の削除状態でも button は出す方針。 */}
			<footer className="mt-1 flex items-center gap-4">
				<button
					type="button"
					aria-label={
						replyCountOptimistic
							? `リプライ ${replyCountOptimistic} 件`
							: "リプライ"
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
					{replyCountOptimistic ? (
						<span aria-hidden="true" className="font-semibold">
							{replyCountOptimistic}
						</span>
					) : null}
				</button>

				{/* #342: 独立「引用」 button を撤去し、RepostButton の DropdownMenu に
				    「引用」項目を吸収 (X 準拠)。count は repost / quote 合算で 1 つの
				    badge として表示する (X TL の慣習)。 */}
				<div className="flex items-center gap-1">
					<RepostButton
						tweetId={displayTweet.id}
						// #351: viewer の永続 repost 状態 (server-fetched) を初期値に
						// 渡す。リロード時に「リポスト済み」 (緑) で正しく復元される。
						initialReposted={displayTweet.reposted_by_me ?? false}
						onPosted={onDescendantPosted}
						onReposted={() => {
							setRepostCountOptimistic((n) => n + 1);
						}}
						onUnreposted={() => {
							setRepostCountOptimistic((n) => Math.max(0, n - 1));
							if (isRepost && tweet.author_handle === currentUserHandle) {
								onTimelineItemRemoved?.(tweet.id);
							}
						}}
						onQuoteRequest={() => setQuoteOpen(true)}
					/>
					{(() => {
						const repostCount = repostCountOptimistic;
						const total = repostCount + quoteCountOptimistic;
						if (total === 0) return null;
						// a11y CRITICAL-2 (#343 review): aria-label と visible text の
						// double-announcement を防ぐため、visible 数字は aria-hidden、
						// SR 用の文言は sr-only span で別出しにする。
						return (
							<>
								<span
									aria-hidden="true"
									className="text-xs text-muted-foreground font-semibold"
								>
									{total}
								</span>
								<span className="sr-only">
									リポスト {repostCount} 件 (うち引用 {quoteCountOptimistic} 件)
								</span>
							</>
						);
					})()}
				</div>

				<ReactionBar tweetId={displayTweet.id} />
			</footer>

			<PostDialog
				tweetId={displayTweet.id}
				mode="reply"
				open={replyOpen}
				onOpenChange={setReplyOpen}
				onPosted={(posted) => {
					setReplyCountOptimistic((n) => n + 1);
					onDescendantPosted?.(posted);
				}}
				parentTweet={{
					id: displayTweet.id,
					author_handle: displayTweet.author_handle,
					author_display_name: displayTweet.author_display_name,
					author_avatar_url: displayTweet.author_avatar_url,
					body: displayTweet.body,
					created_at: displayTweet.created_at,
					is_deleted: displayTweet.is_deleted ?? false,
				}}
			/>
			<PostDialog
				tweetId={displayTweet.id}
				mode="quote"
				open={quoteOpen}
				onOpenChange={setQuoteOpen}
				onPosted={(posted) => {
					setQuoteCountOptimistic((n) => n + 1);
					onDescendantPosted?.(posted);
				}}
				parentTweet={{
					id: displayTweet.id,
					author_handle: displayTweet.author_handle,
					author_display_name: displayTweet.author_display_name,
					author_avatar_url: displayTweet.author_avatar_url,
					body: displayTweet.body,
					created_at: displayTweet.created_at,
					is_deleted: displayTweet.is_deleted ?? false,
				}}
			/>
		</article>
	);
}
