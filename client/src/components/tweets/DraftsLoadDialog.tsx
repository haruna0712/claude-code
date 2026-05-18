"use client";

/**
 * #767 DraftsLoadDialog — TweetComposer 内から下書きを呼び出す modal。
 *
 * spec: docs/specs/tweet-drafts-load-spec.md §3
 *
 * UX:
 * - mount で `GET /tweets/drafts/` を fetch、 新→古 一覧表示
 * - 各 row: body preview (2 行 truncate) + relative datetime + 「編集」「削除」
 * - 「編集」 click → onPick(draft) callback (parent composer に body load)
 * - 「削除」 click → confirm → DELETE → 一覧から消える + toast
 * - 0 件のとき empty state「下書きはまだありません」
 * - 401 → 「ログインが必要です」 toast (composer は閉じない、 router で /login へ)
 *
 * tag 編集は V1 で skip (backend serializer の update が body のみ受付。
 * tag 編集は別 issue で backend 拡張後)。
 */

import { useEffect, useState } from "react";
import { AxiosError } from "axios";
import { FileText, Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { formatJstDateTime } from "@/lib/datetime";
import { deleteTweet, fetchDrafts, type TweetSummary } from "@/lib/api/tweets";

interface DraftsLoadDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** 行 click で composer に load する callback。 dialog は自動で閉じる。 */
	onPick: (draft: TweetSummary) => void;
}

/** aria-label 用に body を 20 文字で truncate。 越えた場合は …  を末尾につける。 */
function truncatedLabel(body: string): string {
	return body.length > 20 ? body.slice(0, 20) + "…" : body;
}

export default function DraftsLoadDialog({
	open,
	onOpenChange,
	onPick,
}: DraftsLoadDialogProps) {
	const [drafts, setDrafts] = useState<TweetSummary[] | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		// reviewer M3: open 再 toggle で前回 list が flash する問題回避のため
		// fetch 開始時に drafts を null (= loading) に戻す。
		setDrafts(null);
		setIsLoading(true);
		fetchDrafts()
			.then((page) => {
				if (!cancelled) setDrafts(page.results);
			})
			.catch((e: unknown) => {
				if (cancelled) return;
				const status = e instanceof AxiosError ? e.response?.status : undefined;
				toast.error(
					status === 401
						? "ログインが必要です。"
						: "下書きの取得に失敗しました",
				);
				setDrafts([]);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const onDelete = async (id: number) => {
		if (!window.confirm("この下書きを削除しますか？")) return;
		setPendingDeleteId(id);
		try {
			await deleteTweet(id);
			setDrafts((prev) => (prev ?? []).filter((d) => d.id !== id));
			toast.success("下書きを削除しました");
		} catch (e) {
			const status = e instanceof AxiosError ? e.response?.status : undefined;
			toast.error(
				status === 401
					? "ログインが必要です。"
					: status === 404
						? "既に削除されています"
						: "削除に失敗しました",
			);
		} finally {
			setPendingDeleteId(null);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>下書き一覧</DialogTitle>
					<DialogDescription>
						保存済みの下書きから 1 件選んで composer に呼び出します。
					</DialogDescription>
				</DialogHeader>

				{isLoading && (
					<div
						className="flex items-center justify-center py-10 text-muted-foreground"
						role="status"
						aria-live="polite"
					>
						<Loader2 className="mr-2 h-5 w-5 animate-spin" />
						<span>読み込み中…</span>
					</div>
				)}

				{!isLoading && drafts && drafts.length === 0 && (
					<div
						className="flex flex-col items-center gap-2 py-10 text-muted-foreground"
						role="status"
					>
						<FileText className="h-8 w-8 opacity-50" />
						<p className="text-sm">下書きはまだありません</p>
					</div>
				)}

				{!isLoading && drafts && drafts.length > 0 && (
					<ul className="flex flex-col gap-2" data-testid="drafts-load-list">
						{drafts.map((draft) => (
							<li
								key={draft.id}
								className="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-start sm:justify-between"
							>
								<div className="min-w-0 flex-1">
									<p className="line-clamp-2 whitespace-pre-wrap break-words text-sm">
										{draft.body}
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										{formatJstDateTime(draft.created_at)}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => onPick(draft)}
										aria-label={`下書き「${truncatedLabel(draft.body)}」を編集する`}
									>
										<Pencil className="mr-1 h-3.5 w-3.5" />
										編集
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										disabled={pendingDeleteId === draft.id}
										onClick={() => onDelete(draft.id)}
										aria-label={`下書き「${truncatedLabel(draft.body)}」を削除する`}
									>
										{pendingDeleteId === draft.id ? (
											<Loader2 className="h-3.5 w-3.5 animate-spin" />
										) : (
											<Trash2 className="h-3.5 w-3.5" />
										)}
									</Button>
								</div>
							</li>
						))}
					</ul>
				)}
			</DialogContent>
		</Dialog>
	);
}
