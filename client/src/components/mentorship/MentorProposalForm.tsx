"use client";

/**
 * MentorProposalForm (P11-07).
 *
 * mentor (非 owner) が `/mentor/wanted/<id>` で proposal を投稿する form。
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import { createMentorProposal } from "@/lib/api/mentor";

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

export default function MentorProposalForm({
	requestId,
}: {
	requestId: number;
}) {
	const router = useRouter();
	const [body, setBody] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [submitted, setSubmitted] = useState(false);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		const trimmed = body.trim();
		if (!trimmed) {
			setError("提案文を入力してください");
			return;
		}
		setSubmitting(true);
		try {
			await createMentorProposal(requestId, trimmed);
			toast.success("提案を送信しました");
			setSubmitted(true);
			setBody("");
			router.refresh();
		} catch (err) {
			setError(describeApiError(err, "提案の送信に失敗しました"));
		} finally {
			setSubmitting(false);
		}
	};

	if (submitted) {
		return (
			<p
				role="status"
				className="rounded border border-[color:var(--a-border)] bg-[color:var(--a-bg-muted)] px-3 py-2 text-sm text-[color:var(--a-text-muted)]"
			>
				提案を送信しました。 mentee が accept すると DM ルームが開きます。
			</p>
		);
	}

	return (
		<form
			onSubmit={handleSubmit}
			aria-label="メンター提案フォーム"
			className="space-y-3"
		>
			{error && (
				<p
					role="alert"
					className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			)}
			<label className="block">
				<span className="block text-sm font-medium">提案文</span>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					maxLength={2000}
					rows={6}
					required
					placeholder={
						"例: AWS infra を 10 年やっています。 ECS の IAM 周りなら 30 分の単発でも対応可能です。"
					}
					className="mt-1 h-[10rem] w-full rounded border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<p className="mt-1 text-xs text-muted-foreground">
					{body.length} / 2000 文字
				</p>
			</label>
			<button
				type="submit"
				disabled={submitting}
				className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{submitting ? "送信中…" : "提案を送る"}
			</button>
		</form>
	);
}
