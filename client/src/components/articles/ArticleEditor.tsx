"use client";

/**
 * ArticleEditor (#536 / Phase 6 P6-13、 PR C で live preview + 画像 D&D 追加).
 *
 * Markdown エディタ + プレビュー (左右 split)。
 * - title / slug (任意) / tags (max 5) / body_markdown 編集
 * - status: draft / published 切替
 * - 公開時は確認 dialog
 * - 既存記事は edit モード (slug 渡される)、新規は create モード
 * - **PR C で追加**: live Markdown preview (react-markdown) + 画像 D&D / paste /
 *   file picker (P6-04 API を消費、 useArticleImageUpload hook で state machine)
 *
 * 公開後は backend `render_article_markdown` (bleach + pygments) を経由するので、
 * preview pane の HTML は **編集中だけ** の暫定表示。 投稿後は ArticleBody で
 * sanitize 済 HTML が描画される。
 */

import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
	useCallback,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type DragEvent,
	type FormEvent,
} from "react";
import { toast } from "react-toastify";

import { useArticleImageUpload } from "@/hooks/useArticleImageUpload";
import type { UploadedImage } from "@/lib/api/articleImages";
import {
	createArticle,
	updateArticle,
	type ArticleDetail,
	type ArticleStatus,
} from "@/lib/api/articles";
import MarkdownPreview from "@/lib/markdown/preview";

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

/**
 * upload 完了で textarea の caret 位置に `![filename](url)` を挿入する。
 * 行頭・行末でない場合は前後に改行を補完して画像が文中で潰れないようにする。
 */
export function insertImageMarkdown(
	current: string,
	caret: number,
	image: UploadedImage,
	filename: string,
): { next: string; nextCaret: number } {
	const alt = filename.replace(/[\]\\]/g, "").trim() || "image";
	const snippet = `![${alt}](${image.url})`;
	const safeCaret = Math.max(0, Math.min(caret, current.length));
	const before = current.slice(0, safeCaret);
	const after = current.slice(safeCaret);
	const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
	const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : "";
	const inserted = `${prefix}${snippet}${suffix}`;
	return {
		next: `${before}${inserted}${after}`,
		nextCaret: safeCaret + inserted.length,
	};
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
	const [isDragging, setIsDragging] = useState(false);

	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const tags = tagsInput
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const handleUploadedImage = useCallback(
		(image: UploadedImage, filename: string) => {
			const ta = textareaRef.current;
			const caret = ta?.selectionStart ?? body.length;
			setBody((current) => {
				const { next, nextCaret } = insertImageMarkdown(
					current,
					caret,
					image,
					filename,
				);
				// 描画後に caret 位置を update する (textarea の selectionStart は
				// state 反映後でないと更新できないので microtask に逃がす)。
				queueMicrotask(() => {
					if (textareaRef.current) {
						textareaRef.current.focus();
						textareaRef.current.setSelectionRange(nextCaret, nextCaret);
					}
				});
				return next;
			});
			toast.success(`「${filename}」 を追加しました`);
		},
		[body.length],
	);

	const handleUploadFailed = useCallback(
		(message: string, filename: string) => {
			toast.error(`「${filename}」 のアップロードに失敗: ${message}`);
		},
		[],
	);

	const { rows: uploadRows, enqueue: enqueueUploads } = useArticleImageUpload({
		onUploaded: handleUploadedImage,
		onFailed: handleUploadFailed,
	});

	const handleFilesFromInput = (e: ChangeEvent<HTMLInputElement>) => {
		const files = e.target.files ? Array.from(e.target.files) : [];
		if (files.length > 0) enqueueUploads(files);
		// reset value so the same file can be picked again next time
		e.target.value = "";
	};

	const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
		const files: File[] = [];
		for (const item of Array.from(e.clipboardData.items)) {
			if (item.kind === "file") {
				const f = item.getAsFile();
				if (f && f.type.startsWith("image/")) files.push(f);
			}
		}
		if (files.length > 0) {
			e.preventDefault();
			enqueueUploads(files);
		}
	};

	const handleDrop = (e: DragEvent<HTMLTextAreaElement>) => {
		const files = Array.from(e.dataTransfer.files).filter((f) =>
			f.type.startsWith("image/"),
		);
		if (files.length > 0) {
			e.preventDefault();
			setIsDragging(false);
			enqueueUploads(files);
		}
	};

	const handleDragOver = (e: DragEvent<HTMLTextAreaElement>) => {
		// 画像 file の drag だけ受け入れる
		if (e.dataTransfer.types.includes("Files")) {
			e.preventDefault();
			setIsDragging(true);
		}
	};

	const handleDragLeave = () => setIsDragging(false);

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

	const activeUploadRows = uploadRows.filter(
		(r) => r.state === "queued" || r.state === "uploading",
	);

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
				<div className="block">
					<div className="flex items-center justify-between gap-2">
						<label
							htmlFor="article-body-textarea"
							className="block text-sm font-medium"
						>
							本文 (Markdown)
						</label>
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
							aria-label="画像を追加"
						>
							<ImagePlus className="size-3.5" aria-hidden="true" />
							画像を追加
						</button>
						<input
							ref={fileInputRef}
							type="file"
							accept="image/jpeg,image/png,image/webp,image/gif"
							multiple
							hidden
							onChange={handleFilesFromInput}
						/>
					</div>
					<textarea
						ref={textareaRef}
						id="article-body-textarea"
						value={body}
						onChange={(e) => setBody(e.target.value)}
						onPaste={handlePaste}
						onDrop={handleDrop}
						onDragOver={handleDragOver}
						onDragLeave={handleDragLeave}
						rows={20}
						maxLength={100_000}
						placeholder={
							"# Heading\n\n本文を Markdown で...\n画像はドラッグ&ドロップ or ペーストでも追加できます"
						}
						required
						aria-describedby="body-help"
						className={`mt-1 h-[28rem] w-full rounded border bg-background p-3 font-mono text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
							isDragging
								? "border-[color:var(--a-accent)] bg-[color:var(--a-bg-subtle)]"
								: "border-border"
						}`}
					/>
					<p id="body-help" className="mt-1 text-xs text-muted-foreground">
						画像はドラッグ&ドロップ / ペースト / 「画像を追加」 button
						で挿入できます (jpeg / png / webp / gif、 5 MiB まで)。
					</p>
				</div>
				<div className="block">
					<span className="block text-sm font-medium">プレビュー</span>
					{activeUploadRows.length > 0 && (
						<ul
							aria-label="アップロード中の画像"
							role="status"
							aria-live="polite"
							className="mt-1 space-y-1 rounded border border-dashed border-border bg-muted/20 p-2 text-xs"
						>
							{activeUploadRows.map((r) => (
								<li key={r.id} className="text-muted-foreground">
									{r.state === "queued" ? "⏳ 待機中: " : "⬆ アップロード中: "}
									{r.filename}
								</li>
							))}
						</ul>
					)}
					<div
						aria-label="本文プレビュー"
						className="mt-1 h-[28rem] overflow-y-auto rounded border border-border bg-muted/20 p-4 text-sm"
					>
						<MarkdownPreview body={body} />
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
