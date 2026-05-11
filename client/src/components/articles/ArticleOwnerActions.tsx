"use client";

/**
 * ArticleOwnerActions (#593 / Phase 6 P6-12 follow-up).
 *
 * 記事詳細ページの sticky header に表示する author 専用の action.
 * - 編集 button (`<Link>`、 `/articles/<slug>/edit` へ)
 * - 削除 button (window.confirm → DELETE /articles/<slug>/ → toast + /articles redirect)
 *
 * 表示判定は parent (server component) で `currentUser.id === article.author.id`
 * を判定してから render する想定。 本 component 自体は owner 前提で受け取る。
 */

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { toast } from "react-toastify";
import { Edit3, Trash2 } from "lucide-react";

import { deleteArticle } from "@/lib/api/articles";

interface ArticleOwnerActionsProps {
	slug: string;
}

function describeApiError(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { status?: number; data?: { detail?: string } };
			message?: string;
		};
		const detail = e.response?.data?.detail;
		if (typeof detail === "string") return detail;
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function ArticleOwnerActions({
	slug,
}: ArticleOwnerActionsProps) {
	const router = useRouter();
	const [busy, setBusy] = useState(false);

	const handleDelete = async () => {
		if (busy) return;
		// CLAUDE.md §4.5 step 6 完了シグナル: window.confirm 流儀 (boards / DM と整合)
		if (!window.confirm("この記事を削除しますか? (元に戻せません)")) return;
		setBusy(true);
		try {
			await deleteArticle(slug);
			toast.success("削除しました");
			router.push("/articles");
			router.refresh();
		} catch (err) {
			toast.error(describeApiError(err, "削除に失敗しました"));
			setBusy(false);
		}
	};

	return (
		<div className="ml-auto flex items-center gap-2">
			<Link
				href={`/articles/${slug}/edit`}
				aria-label="記事を編集"
				className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				style={{
					background: "var(--a-accent)",
					color: "white",
					fontSize: 12.5,
				}}
			>
				<Edit3 className="size-3.5" aria-hidden />
				編集
			</Link>
			<button
				type="button"
				onClick={handleDelete}
				disabled={busy}
				aria-label="記事を削除"
				className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 font-medium transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] disabled:opacity-50"
				style={{
					borderColor: "var(--a-border)",
					color: "var(--a-text-muted)",
					fontSize: 12.5,
				}}
			>
				<Trash2 className="size-3.5" aria-hidden />
				{busy ? "削除中…" : "削除"}
			</button>
		</div>
	);
}
