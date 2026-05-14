"use client";

/**
 * #734 DraftsPanel — `/drafts` page の中身。
 *
 * spec: docs/specs/tweet-drafts-spec.md §4.2
 *
 * UX:
 * - 自分の下書き一覧を新しい順に表示
 * - 各行に「公開する」「削除」 (V1 では「編集」 は Phase B で再 dialog 開く想定)
 * - 「公開する」 click → POST /tweets/<id>/publish/ → 行が消える + toast
 * - 「削除」 click → 確認 dialog → DELETE /tweets/<id>/ → 行が消える + toast
 * - 0 件のときは empty state 「下書きはまだありません」
 */

import { useState } from "react";

import { useRouter } from "next/navigation";
import { AxiosError } from "axios";
import { FileText, Loader2, Send, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

import { Button } from "@/components/ui/button";
import { deleteTweet, publishDraft, type TweetSummary } from "@/lib/api/tweets";

interface DraftsPanelProps {
	initial: TweetSummary[];
}

function formatDate(iso: string): string {
	try {
		return new Date(iso).toLocaleString("ja-JP");
	} catch {
		return iso;
	}
}

export default function DraftsPanel({ initial }: DraftsPanelProps) {
	const router = useRouter();
	const [drafts, setDrafts] = useState<TweetSummary[]>(initial);
	const [pendingId, setPendingId] = useState<number | null>(null);

	const onPublish = async (id: number) => {
		setPendingId(id);
		try {
			await publishDraft(id);
			setDrafts((prev) => prev.filter((d) => d.id !== id));
			toast.success("公開しました");
			router.refresh();
		} catch (e) {
			const status = e instanceof AxiosError ? e.response?.status : undefined;
			toast.error(
				status === 401
					? "ログインが必要です。"
					: status === 404
						? "下書きが見つかりません (既に公開 / 削除された可能性)。"
						: "公開に失敗しました。 再試行してください。",
			);
		} finally {
			setPendingId(null);
		}
	};

	const onDelete = async (id: number) => {
		if (!confirm("この下書きを削除しますか？")) return;
		setPendingId(id);
		try {
			await deleteTweet(id);
			setDrafts((prev) => prev.filter((d) => d.id !== id));
			toast.success("削除しました");
		} catch {
			toast.error("削除に失敗しました。");
		} finally {
			setPendingId(null);
		}
	};

	if (drafts.length === 0) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4 py-10">
				<FileText
					className="size-10 text-[color:var(--a-text-subtle)]"
					aria-hidden
				/>
				<p
					className="text-[color:var(--a-text-muted)]"
					style={{ fontSize: 13.5 }}
				>
					下書きはまだありません。
				</p>
				<p
					className="text-center text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 12 }}
				>
					ホームのコンポーザーで「下書き保存」 を押すとここに保存されます。
				</p>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pb-12 pt-4">
			<ul className="grid gap-3">
				{drafts.map((d) => {
					const isPending = pendingId === d.id;
					return (
						<li
							key={d.id}
							className="grid gap-2 rounded-md border border-border p-4"
						>
							<div
								className="text-[color:var(--a-text-subtle)]"
								style={{ fontSize: 11 }}
							>
								作成日時: {formatDate(d.created_at)}
							</div>
							<div className="whitespace-pre-wrap" style={{ fontSize: 14 }}>
								{d.body}
							</div>
							{d.tags && d.tags.length > 0 ? (
								<div
									className="flex flex-wrap gap-1.5 text-[color:var(--a-text-subtle)]"
									style={{ fontSize: 11.5 }}
								>
									{d.tags.map((t) => (
										<span
											key={t}
											className="rounded-full bg-[color:var(--a-bg-muted)] px-2 py-0.5"
										>
											#{t}
										</span>
									))}
								</div>
							) : null}
							<div className="flex items-center justify-end gap-2 pt-1">
								<Button
									type="button"
									variant="outline"
									onClick={() => onDelete(d.id)}
									disabled={isPending}
									className="inline-flex items-center gap-1.5"
									aria-label={`下書きを削除する`}
								>
									{isPending ? (
										<Loader2
											className="size-4 animate-spin"
											aria-hidden="true"
										/>
									) : (
										<Trash2 className="size-4" aria-hidden="true" />
									)}
									削除
								</Button>
								<Button
									type="button"
									onClick={() => onPublish(d.id)}
									disabled={isPending}
									className="inline-flex items-center gap-1.5"
									aria-label={`下書きを公開する`}
								>
									{isPending ? (
										<Loader2
											className="size-4 animate-spin"
											aria-hidden="true"
										/>
									) : (
										<Send className="size-4" aria-hidden="true" />
									)}
									公開する
								</Button>
							</div>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
