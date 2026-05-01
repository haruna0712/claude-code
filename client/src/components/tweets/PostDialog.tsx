"use client";

/**
 * PostDialog — minimal modal for Quote / Reply composer (P2-15 / Issue #188).
 *
 * MVP: Uses Radix Dialog primitive (already a dep). Inline textarea +
 * submit button; tag chips and images are deferred — Phase 1 Composer is
 * not reused as-is because that component owns POST /tweets/, while
 * Quote/Reply target sub-actions on /tweets/<id>/{quote,reply}/.
 */

import { Dialog, DialogContent, DialogTitle } from "@radix-ui/react-dialog";
import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import { quoteTweet, replyToTweet } from "@/lib/api/repost";
import type { TweetSummary } from "@/lib/api/tweets";

export type PostDialogMode = "quote" | "reply";

interface PostDialogProps {
	tweetId: number;
	mode: PostDialogMode;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPosted?: (tweet: TweetSummary) => void;
}

const MAX_BODY = 180;

export default function PostDialog({
	tweetId,
	mode,
	open,
	onOpenChange,
	onPosted,
}: PostDialogProps) {
	const [body, setBody] = useState("");
	const [busy, setBusy] = useState(false);

	const title = mode === "quote" ? "引用リポスト" : "リプライ";
	const submitLabel = mode === "quote" ? "引用する" : "返信する";

	const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = body.trim();
		if (!trimmed || busy) return;

		setBusy(true);
		try {
			const result =
				mode === "quote"
					? await quoteTweet(tweetId, { body: trimmed })
					: await replyToTweet(tweetId, { body: trimmed });
			onPosted?.(result);
			setBody("");
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

				<form onSubmit={onSubmit} className="flex flex-col gap-3">
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						maxLength={MAX_BODY}
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
						<span className="text-xs text-muted-foreground">
							{body.length} / {MAX_BODY}
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
								disabled={busy || body.trim().length === 0}
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
