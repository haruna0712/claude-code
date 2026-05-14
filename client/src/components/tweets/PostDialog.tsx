"use client";

/**
 * PostDialog — modal for Quote / Reply composer (P2-15 / Issue #188).
 *
 * #325 で受入消化:
 * - parentTweet を受け取り、上部に元 tweet の inline preview を表示
 *   (Reply: "Replying to @<handle>" banner、Quote: 引用カード形式)
 * - 文字数カウントを countTweetChars で計算 (URL=23 字換算等)
 * - parentTweet.is_deleted=true なら open を block (toast)
 */

import { Dialog, DialogContent, DialogTitle } from "@radix-ui/react-dialog";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import { useAutoSaveDraft } from "@/hooks/useAutoSaveDraft";
import { quoteTweet, replyToTweet } from "@/lib/api/repost";
import type { TweetMini, TweetSummary } from "@/lib/api/tweets";
import { TWEET_MAX_CHARS, countTweetChars } from "@/lib/tweets/charCount";

export type PostDialogMode = "quote" | "reply";

interface PostDialogProps {
	tweetId: number;
	mode: PostDialogMode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPosted?: (tweet: TweetSummary) => void;
	/** #325: 元 tweet (preview 表示 + is_deleted guard 用)。 */
	parentTweet?: TweetMini | null;
}

export default function PostDialog({
	tweetId,
	mode,
	open,
	onOpenChange,
	onPosted,
	parentTweet,
}: PostDialogProps) {
	// #739: reply / quote 別 + 対象 tweet 別に書きかけを localStorage 保存。
	const {
		value: body,
		setValue: setBody,
		clear: clearBodyAutosave,
	} = useAutoSaveDraft(`composer:${mode}:${tweetId}`);
	const [busy, setBusy] = useState(false);

	const title = mode === "quote" ? "引用リポスト" : "リプライ";
	const submitLabel = mode === "quote" ? "引用する" : "返信する";

	// #325: parentTweet が削除済みなら dialog を強制 close + toast
	useEffect(() => {
		if (open && parentTweet?.is_deleted) {
			toast.error("削除されたツイートには操作できません。");
			onOpenChange(false);
		}
	}, [open, parentTweet?.is_deleted, onOpenChange]);

	// #325: countTweetChars で URL 23 字換算 / Markdown 除外。
	const visibleCount = countTweetChars(body);
	const overLimit = visibleCount > TWEET_MAX_CHARS;

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = body.trim();
		if (!trimmed || busy || overLimit) return;

		setBusy(true);
		try {
			const result =
				mode === "quote"
					? await quoteTweet(tweetId, { body: trimmed })
					: await replyToTweet(tweetId, { body: trimmed });
			onPosted?.(result);
			// #739: 送信成功で autosave key を確実に消す
			clearBodyAutosave();
			onOpenChange(false);
		} catch {
			toast.error("投稿に失敗しました");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				role="dialog"
				aria-labelledby="post-dialog-title"
				className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-4 shadow-lg max-w-md w-[92vw]"
			>
				<DialogTitle
					id="post-dialog-title"
					className="text-base font-semibold mb-3 text-foreground"
				>
					{title}
				</DialogTitle>

				{/* #325: 元 tweet の inline preview。Reply は banner、Quote は枠カード。 */}
				{parentTweet && !parentTweet.is_deleted ? (
					<div className="mb-3">
						{mode === "reply" ? (
							<p className="text-xs text-muted-foreground mb-2">
								Replying to{" "}
								<span className="font-medium text-foreground">
									@{parentTweet.author_handle}
								</span>
							</p>
						) : null}
						<div
							className={`rounded-md border border-border bg-muted/30 px-3 py-2 text-xs ${mode === "reply" ? "" : "border-l-4"}`}
						>
							<div className="mb-1 flex items-center gap-2 text-muted-foreground">
								<span className="font-medium text-foreground">
									{parentTweet.author_display_name || parentTweet.author_handle}
								</span>
								<span>@{parentTweet.author_handle}</span>
							</div>
							<p className="line-clamp-3 whitespace-pre-wrap text-foreground">
								{parentTweet.body}
							</p>
						</div>
					</div>
				) : null}

				<form onSubmit={onSubmit} className="flex flex-col gap-3">
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						rows={4}
						placeholder={
							mode === "quote"
								? "引用にコメントを添えて投稿..."
								: "返信を書く..."
						}
						aria-label={`${title}の本文`}
						className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<div className="flex items-center justify-between gap-2">
						<span
							className={`text-xs ${overLimit ? "text-baby_red font-semibold" : "text-muted-foreground"}`}
							aria-live="polite"
						>
							{visibleCount} / {TWEET_MAX_CHARS}
						</span>
						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => onOpenChange(false)}
								className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								キャンセル
							</button>
							<button
								type="submit"
								disabled={busy || body.trim().length === 0 || overLimit}
								className="rounded-md bg-lime-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-lime-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
							>
								{submitLabel}
							</button>
						</div>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
