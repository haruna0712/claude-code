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
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
	type ClipboardEvent,
	type DragEvent,
	type FormEvent,
	type KeyboardEvent,
} from "react";
import { toast } from "react-toastify";

import { useArticleImageUpload } from "@/hooks/useArticleImageUpload";
import { loadStoredDraft, useAutoSaveSync } from "@/hooks/useAutoSaveDraft";
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
 * #616: body 先頭の h1 (`# ...`) が title と一致するなら重複表示の origin になる。
 * editor 側で warning を出すための判定。 先頭の whitespace / blank line を許容し、
 * trim 後の大文字小文字無視で照合する (タイポ修正の途中状態を warn し過ぎない)。
 *
 * 一致しない / そもそも body が `#` で始まらない時は null を返して非表示にする。
 */
export function detectBodyH1MatchesTitle(
	title: string,
	body: string,
): string | null {
	const t = title.trim();
	if (!t) return null;
	const lines = body.split("\n");
	const firstNonBlank = lines.find((l) => l.trim().length > 0);
	if (!firstNonBlank) return null;
	const m = /^#\s+(.+?)\s*$/.exec(firstNonBlank.trim());
	if (!m) return null;
	const h1Text = m[1].trim();
	if (h1Text.toLowerCase() === t.toLowerCase()) {
		return h1Text;
	}
	return null;
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
	// markdown image alt text に `[` `]` `\` が残ると `![alt](url)` の parse が崩れる。
	// 全部除去する (typescript-reviewer H-1 反映、 旧コードは `]` `\` のみ除去で
	// 「[shot].png」 が `![[shot.png](url)` という malformed を生んでいた)。
	const alt = filename.replace(/[[\]\\]/g, "").trim() || "image";
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
	// #739: 書きかけ autosave。 新規 vs 編集で key を分ける。
	// 編集モードは記事 slug をキーに、 新規は固定 key (= 1 ユーザー 1 件)。
	const draftScope =
		mode === "edit" && initial?.slug ? `edit:${initial.slug}` : "new";
	const titleKey = `composer:article:${draftScope}:title`;
	const bodyKey = `composer:article:${draftScope}:body`;
	// 初期値は localStorage 優先、 無ければ initial を使う。
	const [title, setTitle] = useState(() =>
		loadStoredDraft(titleKey, initial?.title ?? ""),
	);
	const [slug, setSlug] = useState(initial?.slug ?? "");
	const [body, setBody] = useState(() =>
		loadStoredDraft(bodyKey, initial?.body_markdown ?? ""),
	);
	// debounce 付きで localStorage に書き戻す
	const { clear: clearTitleAutosave } = useAutoSaveSync(titleKey, title);
	const { clear: clearBodyAutosave } = useAutoSaveSync(bodyKey, body);
	const [tagsInput, setTagsInput] = useState(
		(initial?.tags ?? []).map((t) => t.slug).join(", "),
	);
	const [status, setStatus] = useState<ArticleStatus>(
		initial?.status ?? "draft",
	);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	// #780 fix: Write / Preview のタブ切替 (Zenn 流)。 同時並列ではなく排他切替。
	const [viewMode, setViewMode] = useState<"write" | "preview">("write");

	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	// #782: WAI-ARIA tabs pattern の roving tabindex で、 ArrowKey 切替時に
	// 次の tab に明示 focus を返すため、 各 tab button の ref を保持。
	const writeTabRef = useRef<HTMLButtonElement | null>(null);
	const previewTabRef = useRef<HTMLButtonElement | null>(null);
	// upload 完了で caret を移動させたい位置を保持。 setBody の updater 内では
	// 副作用 (DOM 操作) を起こさず、 commit 後に useEffect 経由で flush する
	// (typescript-reviewer M-3 反映、 React Strict Mode の double-call で
	// setSelectionRange が連発するのを防ぐ)。
	const pendingCaretRef = useRef<number | null>(null);

	// code-reviewer H-2 反映: body 更新ごとに pendingCaretRef を flush。 dep array
	// なしの useEffect は毎レンダー走ってオーバーヘッドになるので body を観測する形に。
	// typescript-reviewer HIGH (#780): viewMode が "preview" のとき textarea は
	// hidden なので、 focus / setSelectionRange を skip する (= 不可視要素への
	// focus 奪取を防ぐ)。 viewMode は ref 経由ではなく毎レンダー closure 経由で読む
	// (= 再 schedule 不要、 「現在の状態」 として参照するだけ)。
	useEffect(() => {
		if (pendingCaretRef.current === null) return;
		const target = pendingCaretRef.current;
		pendingCaretRef.current = null;
		const ta = textareaRef.current;
		if (ta && viewMode === "write") {
			ta.focus();
			ta.setSelectionRange(target, target);
		}
	}, [body, viewMode]);

	// #780: Write タブに戻ったら textarea にフォーカスを戻す (UX 改善)。
	// typescript-reviewer HIGH (#780): mount 時の発火を抑制。 default viewMode が
	// "write" のため、 初回 mount で page 全体の focus を奪うのを防ぐ。 切替時のみ
	// focus を返す。
	const firstViewModeRender = useRef(true);
	useEffect(() => {
		if (firstViewModeRender.current) {
			firstViewModeRender.current = false;
			return;
		}
		if (viewMode === "write") {
			textareaRef.current?.focus({ preventScroll: true });
		}
	}, [viewMode]);

	// #780: tablist keyboard nav。 ArrowLeft/Right で前/次の tab に自動 activate、
	// Home/End は 2 tab しかないため Write/Preview を直接指す。
	// #782 gan-evaluator HIGH: WAI-ARIA tabs pattern の roving tabindex を完成
	// させるため、 setViewMode 後に次の tab button へ明示 focus を渡す。
	const handleTabKey = useCallback((e: KeyboardEvent<HTMLButtonElement>) => {
		const focusTab = (next: "write" | "preview") => {
			const ref = next === "write" ? writeTabRef : previewTabRef;
			ref.current?.focus();
		};
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			e.preventDefault();
			let next: "write" | "preview" = "write";
			setViewMode((m) => {
				next = m === "write" ? "preview" : "write";
				return next;
			});
			// state 更新後に focus を移すが、 React は同期 batch するので
			// next を closure で持っておけば確実に該当 tab に focus 移動できる。
			queueMicrotask(() => focusTab(next));
			return;
		}
		if (e.key === "Home") {
			e.preventDefault();
			setViewMode("write");
			queueMicrotask(() => focusTab("write"));
			return;
		}
		if (e.key === "End") {
			e.preventDefault();
			setViewMode("preview");
			queueMicrotask(() => focusTab("preview"));
		}
	}, []);

	const tags = tagsInput
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const initialTitle = initial?.title ?? "";
	const initialSlug = initial?.slug ?? "";
	const initialBody = initial?.body_markdown ?? "";
	const initialStatus = initial?.status ?? "draft";
	const initialTagsInput = (initial?.tags ?? []).map((t) => t.slug).join(", ");
	const isDirty =
		title !== initialTitle ||
		slug !== initialSlug ||
		body !== initialBody ||
		status !== initialStatus ||
		tagsInput !== initialTagsInput;

	const handleCancel = () => {
		if (isDirty) {
			const ok = window.confirm("未保存の変更を破棄して戻りますか？");
			if (!ok) return;
		}
		if (mode === "edit" && initial?.slug) {
			router.push(`/articles/${initial.slug}`);
		} else {
			router.push("/articles");
		}
	};

	const handleUploadedImage = useCallback(
		(image: UploadedImage, filename: string) => {
			// caret 位置は textarea から live で読む (typescript-reviewer H-2)。
			// 取れない (focus 失われ) ときは current state の末尾を使う。
			setBody((current) => {
				const caret = textareaRef.current?.selectionStart ?? current.length;
				const { next, nextCaret } = insertImageMarkdown(
					current,
					caret,
					image,
					filename,
				);
				// updater は pure に保ち、 caret 復元は useEffect で flush。
				pendingCaretRef.current = nextCaret;
				return next;
			});
			toast.success(`「${filename}」 を追加しました`);
		},
		// dep 空: setBody は stable、 textareaRef / pendingCaretRef も ref で stable。
		[],
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

	const handleDragLeave = (e: DragEvent<HTMLTextAreaElement>) => {
		// a11y-architect L-1: 内部 child element 越境では消さない。
		// relatedTarget が textarea の subtree なら状態維持。
		const target = e.relatedTarget;
		if (target instanceof Node && e.currentTarget.contains(target)) {
			return;
		}
		setIsDragging(false);
	};

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
				toast.success(
					status === "published" ? "公開しました" : "下書きを保存しました",
				);
				// #739: 送信成功で autosave key を clear (pending debounce も cancel)
				clearTitleAutosave();
				clearBodyAutosave();
				router.push(`/articles/${created.slug}`);
			} else if (initial) {
				const updated = await updateArticle(initial.slug, {
					title: trimmed,
					body_markdown: body,
					slug: slug.trim() || undefined,
					status,
					tags,
				});
				toast.success(
					status === "published" ? "公開しました" : "下書きを保存しました",
				);
				clearTitleAutosave();
				clearBodyAutosave();
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

	// #616: title と body 1 行目の h1 が一致しているか。 null なら警告なし。
	const titleH1Duplicate = detectBodyH1MatchesTitle(title, body);

	// #780: 保存 button の label (= mode + status の組み合わせで決まる)
	const submitLabel = submitting
		? "保存中…"
		: mode === "create"
			? status === "published"
				? "公開する"
				: "下書き保存"
			: status === "published"
				? "更新して公開"
				: "更新";

	return (
		<form onSubmit={handleSubmit} className="space-y-3">
			{error && (
				<p
					role="alert"
					className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
				>
					{error}
				</p>
			)}

			{/* #780 Zenn 流 2-col layout: main (editor/preview) + 右 sidebar (metadata)。
			    #784: breakpoint を lg → xl に上げ、 sidebar 幅 320 → 280。
			    #786: 1280 viewport で textarea が 55% に縮む regression を解消する
			    ため sidebar を `xl` (1280-1535) で 240px、 `2xl` (1536+) で 280px に
			    段階化。 + gap を 4 → 3 (= -4px)。 1280 で main col +44px (= sidebar
			    -40 + gap -4) で textarea が 60%+ に到達 (= ハルナさん要望「広く」 達成)。 */}
			<div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_240px] 2xl:grid-cols-[minmax(0,1fr)_280px]">
				{/* main col: tablist + editor / preview panel */}
				<div className="flex min-w-0 flex-col">
					{/* tablist (Write / Preview) + 右端に「画像を追加」 + Cancel + 保存 */}
					<div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
						<div
							role="tablist"
							aria-label="エディタ表示モード"
							aria-orientation="horizontal"
							className="flex items-center gap-1"
						>
							<button
								ref={writeTabRef}
								type="button"
								role="tab"
								id="editor-tab-write"
								aria-selected={viewMode === "write"}
								aria-controls="editor-panel-write"
								tabIndex={viewMode === "write" ? 0 : -1}
								onClick={() => setViewMode("write")}
								onKeyDown={handleTabKey}
								className={`min-h-[32px] rounded-t border-b-2 px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
									viewMode === "write"
										? "border-[color:var(--a-accent)] text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								Write
							</button>
							<button
								ref={previewTabRef}
								type="button"
								role="tab"
								id="editor-tab-preview"
								aria-selected={viewMode === "preview"}
								aria-controls="editor-panel-preview"
								tabIndex={viewMode === "preview" ? 0 : -1}
								onClick={() => setViewMode("preview")}
								onKeyDown={handleTabKey}
								className={`min-h-[32px] rounded-t border-b-2 px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
									viewMode === "preview"
										? "border-[color:var(--a-accent)] text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground"
								}`}
							>
								Preview
							</button>
						</div>
						{/* tablist の右側 (= form 行動 button 群) */}
						<div className="ml-auto flex flex-wrap items-center gap-2">
							{viewMode === "write" && (
								<>
									<button
										type="button"
										onClick={() => fileInputRef.current?.click()}
										// a11y-architect H-1 / M-3 既存維持
										className="inline-flex min-h-[32px] items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
										aria-label="画像を追加"
										aria-haspopup="dialog"
									>
										<ImagePlus className="size-3.5" aria-hidden="true" />
										画像を追加
									</button>
									<input
										ref={fileInputRef}
										type="file"
										aria-label="画像ファイルを選択"
										accept="image/jpeg,image/png,image/webp,image/gif"
										multiple
										hidden
										onChange={handleFilesFromInput}
									/>
								</>
							)}
							<button
								type="button"
								onClick={handleCancel}
								disabled={submitting}
								className="min-h-[32px] rounded-full border border-border px-4 py-1 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
							>
								キャンセル
							</button>
							<button
								type="submit"
								disabled={submitting}
								className="min-h-[32px] rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{submitLabel}
							</button>
						</div>
					</div>

					{/* Write tabpanel
					    #782 gan-evaluator CRITICAL: HTML `hidden` attribute は `display: none`
					    を適用するが、 className の `flex` (= `display: flex`) で上書き
					    されるため両 panel が同時描画される regression が出ていた。
					    `hidden` + `style.display: 'none'` を併用して確実に非表示にする
					    (`hidden` は a11y tree からも除外するので残す)。 */}
					<div
						role="tabpanel"
						id="editor-panel-write"
						aria-labelledby="editor-tab-write"
						hidden={viewMode !== "write"}
						style={viewMode !== "write" ? { display: "none" } : undefined}
						className="mt-2 flex min-h-0 flex-1 flex-col"
					>
						<textarea
							ref={textareaRef}
							id="article-body-textarea"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							onPaste={handlePaste}
							onDrop={handleDrop}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							maxLength={100_000}
							placeholder={
								"# Heading\n\n本文を Markdown で...\n画像はドラッグ&ドロップ or ペーストでも追加できます"
							}
							required
							aria-label="本文 (Markdown)"
							aria-describedby="body-help"
							className={`h-[calc(100vh-220px)] min-h-[24rem] w-full rounded p-3 font-mono text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
								isDragging
									? "ring-[color:var(--a-accent)]/40 border-2 border-dashed border-[color:var(--a-accent)] bg-[color:var(--a-bg-subtle)] ring-2"
									: "border border-border bg-background"
							}`}
						/>
						<p id="body-help" className="mt-1 text-xs text-muted-foreground">
							画像はドラッグ&ドロップ / ペースト / 「画像を追加」 button
							で挿入できます (jpeg / png / webp / gif、 5 MiB まで)。
						</p>
						{titleH1Duplicate !== null && (
							<p
								role="status"
								aria-live="polite"
								className="mt-1 rounded border border-yellow-400/60 bg-yellow-50/80 px-2 py-1 text-xs text-yellow-900 dark:border-yellow-500/30 dark:bg-yellow-900/20 dark:text-yellow-100"
							>
								タイトルと本文 1 行目「# {titleH1Duplicate}」 が同じです。
								詳細ページで見出しが二重に表示される可能性があります。
							</p>
						)}
						{/* a11y-architect M-1: 集約 SR 通知。 視覚 list は別途。 */}
						<p role="status" aria-live="polite" className="sr-only">
							{activeUploadRows.length > 0
								? `${activeUploadRows.length} 件の画像をアップロード中`
								: ""}
						</p>
						{activeUploadRows.length > 0 && (
							<ul
								aria-label="アップロード中の画像"
								className="mt-1 space-y-1 rounded border border-dashed border-border bg-muted/20 p-2 text-xs"
							>
								{activeUploadRows.map((r) => (
									<li key={r.id} className="text-muted-foreground">
										{r.state === "queued"
											? "⏳ 待機中: "
											: "⬆ アップロード中: "}
										{r.filename}
									</li>
								))}
							</ul>
						)}
					</div>

					{/* Preview tabpanel
					    #782 gan-evaluator CRITICAL: 上記 Write panel と同じ理由で
					    `hidden` + `style.display: 'none'` を併用。 */}
					<div
						role="tabpanel"
						id="editor-panel-preview"
						aria-labelledby="editor-tab-preview"
						hidden={viewMode !== "preview"}
						style={viewMode !== "preview" ? { display: "none" } : undefined}
						tabIndex={0}
						aria-label="本文プレビュー"
						className="mt-2 h-[calc(100vh-220px)] min-h-[24rem] overflow-y-auto rounded border border-border bg-muted/20 p-4 text-sm"
					>
						<MarkdownPreview body={body} />
						<p className="mt-3 text-xs text-muted-foreground">
							※ 投稿後はサーバー側のサニタイザを通した HTML が表示されます。
						</p>
					</div>
				</div>

				{/* 右 sidebar: タイトル / slug / タグ / 公開ステータス */}
				<aside aria-label="記事の設定" className="space-y-3 xl:pt-2">
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
							<ul
								aria-label="入力中のタグ"
								className="mt-1 flex flex-wrap gap-1"
							>
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

					<fieldset className="space-y-2 rounded border border-border bg-muted/10 p-3">
						<legend className="px-1 text-sm font-medium">公開ステータス</legend>
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
				</aside>
			</div>
		</form>
	);
}
