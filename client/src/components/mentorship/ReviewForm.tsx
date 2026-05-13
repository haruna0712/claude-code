"use client";

/**
 * ReviewForm (P11-21).
 *
 * 契約完了後の mentee が mentor を ★1-5 + comment で評価する form。
 * 既存 review があれば pre-populate して上書き編集も可能。
 */

import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import { submitContractReview, type MentorReview } from "@/lib/api/mentor";

function describeApiError(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { data?: Record<string, unknown> };
			message?: string;
		};
		const data = e.response?.data;
		if (data && typeof data === "object") {
			const detail = (data as { detail?: string }).detail;
			if (typeof detail === "string") return detail;
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function ReviewForm({
	contractId,
	existing,
}: {
	contractId: number;
	existing?: MentorReview | null;
}) {
	const [rating, setRating] = useState<number>(existing?.rating ?? 5);
	const [comment, setComment] = useState<string>(existing?.comment ?? "");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		if (!comment.trim()) {
			setError("コメントを入力してください");
			return;
		}
		setSubmitting(true);
		try {
			await submitContractReview(contractId, rating, comment.trim());
			toast.success(
				existing ? "レビューを更新しました" : "レビューを投稿しました",
			);
			setDone(true);
		} catch (err) {
			setError(describeApiError(err, "送信に失敗しました"));
		} finally {
			setSubmitting(false);
		}
	};

	if (done) {
		return (
			<p
				role="status"
				className="rounded border border-[color:var(--a-border)] bg-[color:var(--a-bg-muted)] px-3 py-2 text-sm"
			>
				✅ レビューを送信しました。 mentor のプロフィールに表示されます。
			</p>
		);
	}

	return (
		<form
			onSubmit={handleSubmit}
			aria-label="メンターレビューフォーム"
			className="space-y-3 rounded-lg border border-[color:var(--a-border)] p-4"
		>
			{error && (
				<p
					role="alert"
					className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			)}
			<fieldset>
				<legend className="block text-sm font-medium">評価</legend>
				<div className="mt-1 flex items-center gap-1">
					{[1, 2, 3, 4, 5].map((n) => (
						<button
							key={n}
							type="button"
							onClick={() => setRating(n)}
							aria-label={`★ ${n}`}
							className={`size-8 rounded-full text-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
								n <= rating
									? "text-yellow-500"
									: "text-[color:var(--a-text-muted)]"
							}`}
						>
							★
						</button>
					))}
					<span className="ml-2 text-sm">{rating} / 5</span>
				</div>
			</fieldset>
			<label className="block">
				<span className="block text-sm font-medium">コメント</span>
				<textarea
					value={comment}
					onChange={(e) => setComment(e.target.value)}
					maxLength={2000}
					rows={5}
					placeholder="どのような点が良かったか、 具体的に書くと他の mentee の参考になります。"
					className="mt-1 h-[8rem] w-full rounded border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<p className="mt-1 text-xs text-muted-foreground">
					{comment.length} / 2000 文字
				</p>
			</label>
			<button
				type="submit"
				disabled={submitting}
				className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{submitting
					? "送信中…"
					: existing
						? "レビューを更新"
						: "レビューを投稿"}
			</button>
		</form>
	);
}
