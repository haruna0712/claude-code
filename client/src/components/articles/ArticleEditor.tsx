"use client";

/**
 * ArticleEditor (#536 / Phase 6 P6-13).
 *
 * Markdown エディタ + プレビュー (左右 split)。
 * - title / slug (任意) / tags (max 5) / body_markdown 編集
 * - status: draft / published 切替
 * - 公開時は確認 dialog
 * - 既存記事は edit モード (slug 渡される)、新規は create モード
 *
 * 画像 D&D は MVP では割愛 (P6-04 完了後 follow-up issue で組み込む)。
 * Markdown プレビューは backend の sanitizer を信頼する都合上、
 * draft 段階では client 側で `marked` で軽量プレビューする。
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import {
	createArticle,
	updateArticle,
	type ArticleDetail,
	type ArticleStatus,
} from "@/lib/api/articles";

interface ArticleEditorProps {
	mode: "create" | "edit";
	initial?: Pick<
		ArticleDetail,
		"slug" | "title" | "body_markdown" | "status" | "tags"
	>;
}

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

export default function ArticleEditor({ mode, initial }: ArticleEditorProps) {
	const router = useRouter();
	const [title, setTitle] = useState(initial?.title ?? "");
	const [slug, setSlug] = useState(initial?.slug ?? "");
	const [body, setBody] = useState(initial?.body_markdown ?? "");
	const [tagsInput, setTagsInput] = useState(
		(initial?.tags ?? []).map((t) => t.slug).join(", "),
	);
	const [status, setStatus] = useState<ArticleStatus>(
		initial?.status ?? "draft",
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const tags = tagsInput
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const handleSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setError(null);
		const trimmed = title.trim();
		if (!trimmed) {
			setError("タイトルを入力してください");
			return;
		}
		if (!body.trim()) {
			setError("本文を入力してください");
			return;
		}
		if (status === "published") {
			const ok = window.confirm(
				"公開すると記事 URL に公開され、自動ツイートも投稿されます。よろしいですか？",
			);
			if (!ok) return;
		}
		setSubmitting(true);
		try {
			if (mode === "create") {
				const created = await createArticle({
					title: trimmed,
					body_markdown: body,
					slug: slug.trim() || undefined,
					status,
					tags,
				});
				router.push(`/articles/${created.slug}`);
			} else if (initial) {
				const updated = await updateArticle(initial.slug, {
					title: trimmed,
					body_markdown: body,
					slug: slug.trim() || undefined,
					status,
					tags,
				});
				router.push(`/articles/${updated.slug}`);
			}
		} catch (err) {
			setError(describeApiError(err, "保存に失敗しました"));
			setSubmitting(false);
		}
	};

	return (
		<form onSubmit={handleSubmit} className="space-y-4">
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
					maxLength={120}
					placeholder="記事のタイトル (1〜120 字)"
					required
					className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</label>

			<label className="block">
				<span className="block text-sm font-medium">
					slug (任意、未指定なら title から自動生成)
				</span>
				<input
					type="text"
					value={slug}
					onChange={(e) => setSlug(e.target.value)}
					maxLength={120}
					placeholder="my-first-post"
					pattern="[\w\-]+"
					className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
			</label>

			<label className="block">
				<span className="block text-sm font-medium">
					タグ (カンマ区切り、最大 5 個)
				</span>
				<input
					type="text"
					value={tagsInput}
					onChange={(e) => setTagsInput(e.target.value)}
					placeholder="django, nextjs, aws"
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

			<div className="grid gap-3 lg:grid-cols-2">
				<label className="block">
					<span className="block text-sm font-medium">本文 (Markdown)</span>
					<textarea
						value={body}
						onChange={(e) => setBody(e.target.value)}
						rows={20}
						maxLength={100_000}
						placeholder={"# Heading\n\n本文を Markdown で..."}
						required
						className="mt-1 h-[28rem] w-full rounded border border-border bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</label>
				<div className="block">
					<span className="block text-sm font-medium">プレビュー</span>
					<div
						aria-label="本文プレビュー"
						className="mt-1 h-[28rem] overflow-y-auto whitespace-pre-wrap rounded border border-border bg-muted/20 p-4 text-sm"
					>
						{body || (
							<span className="text-muted-foreground">
								(本文がここに表示されます)
							</span>
						)}
					</div>
					<p className="mt-1 text-xs text-muted-foreground">
						※ 投稿後はサーバー側のサニタイザを通した HTML が表示されます。
					</p>
				</div>
			</div>

			<fieldset className="flex items-center gap-4">
				<legend className="sr-only">公開ステータス</legend>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="status"
						value="draft"
						checked={status === "draft"}
						onChange={() => setStatus("draft")}
					/>
					下書き
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="status"
						value="published"
						checked={status === "published"}
						onChange={() => setStatus("published")}
					/>
					公開
				</label>
			</fieldset>

			<button
				type="submit"
				disabled={submitting}
				className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
			>
				{submitting
					? "保存中…"
					: mode === "create"
						? status === "published"
							? "公開する"
							: "下書き保存"
						: status === "published"
							? "更新して公開"
							: "更新"}
			</button>
		</form>
	);
}
