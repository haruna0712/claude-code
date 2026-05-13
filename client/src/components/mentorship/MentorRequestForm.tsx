"use client";

/**
 * MentorRequestForm (P11-06).
 *
 * mentee が `/mentor/wanted/new` で投稿する form。 title (1-80) + body (1-2000) +
 * target_skill_tag_names (csv) のシンプル構成。 成功で詳細ページに遷移 + toast。
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import { createMentorRequest } from "@/lib/api/mentor";

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
			const firstField = Object.values(data)[0];
			if (Array.isArray(firstField) && typeof firstField[0] === "string") {
				return firstField[0];
			}
			if (typeof firstField === "string") return firstField;
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function MentorRequestForm() {
	const router = useRouter();
	const [title, setTitle] = useState("");
	const [body, setBody] = useState("");
	const [tagsInput, setTagsInput] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const tags = tagsInput
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		const trimmedTitle = title.trim();
		const trimmedBody = body.trim();
		if (!trimmedTitle) {
			setError("タイトルを入力してください");
			return;
		}
		if (!trimmedBody) {
			setError("本文を入力してください");
			return;
		}
		setSubmitting(true);
		try {
			const created = await createMentorRequest({
				title: trimmedTitle,
				body: trimmedBody,
				target_skill_tag_names: tags,
			});
			toast.success("募集を投稿しました");
			router.push(`/mentor/wanted/${created.id}`);
		} catch (err) {
			setError(describeApiError(err, "投稿に失敗しました"));
			setSubmitting(false);
		}
	};

	return (
		<form
			onSubmit={handleSubmit}
			className="space-y-4"
			aria-label="メンター募集フォーム"
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
				<span className="block text-sm font-medium">タイトル</span>
				<input
					type="text"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					maxLength={80}
					required
					placeholder="例: Django + DRF の認証回りで詰まっています"
					className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</label>

			<label className="block">
				<span className="block text-sm font-medium">本文</span>
				<textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					maxLength={2000}
					rows={10}
					required
					placeholder={
						"相談したい内容を詳しく書いてください。\n- 現状とゴール\n- 試したこと\n- どこで詰まっているか"
					}
					className="mt-1 h-[14rem] w-full rounded border border-border bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<p className="mt-1 text-xs text-muted-foreground">
					{body.length} / 2000 文字
				</p>
			</label>

			<label className="block">
				<span className="block text-sm font-medium">
					関連スキル (カンマ区切り、 既存タグのみ。 最大 5 個)
				</span>
				<input
					type="text"
					value={tagsInput}
					onChange={(e) => setTagsInput(e.target.value)}
					placeholder="例: django, drf, python"
					className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				{tags.length > 0 && (
					<ul aria-label="入力中のタグ" className="mt-1 flex flex-wrap gap-1">
						{tags.map((t) => (
							<li
								key={t}
								className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
							>
								#{t}
							</li>
						))}
					</ul>
				)}
			</label>

			<button
				type="submit"
				disabled={submitting}
				className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{submitting ? "投稿中…" : "募集を投稿する"}
			</button>
		</form>
	);
}
