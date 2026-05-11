/**
 * ThreadRow (Phase 5 / Issue #432).
 *
 * /boards/<slug> のスレ一覧 1 行。タイトル + 投稿数 + 最終投稿時刻 + ロック。
 */

import Link from "next/link";

import type { ThreadSummary } from "@/lib/api/boards";

interface ThreadRowProps {
	thread: ThreadSummary;
}

function formatDateTime(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleString("ja-JP", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		});
	} catch {
		return iso;
	}
}

export default function ThreadRow({ thread }: ThreadRowProps) {
	const authorLabel =
		thread.author?.display_name ||
		thread.author?.handle ||
		"削除されたユーザー";
	return (
		<li className="border-b border-[color:var(--a-border)] last:border-b-0">
			<Link
				href={`/threads/${thread.id}`}
				className="block px-4 py-3 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				aria-label={`${thread.title} (${thread.post_count} レス)`}
			>
				<div className="flex items-center justify-between gap-3">
					<h3 className="flex-1 truncate text-base font-medium text-[color:var(--a-text)]">
						{thread.title}
						{thread.locked && (
							<span
								className="ml-2 inline-block rounded bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
								aria-label="ロック済"
							>
								🔒
							</span>
						)}
					</h3>
					<span className="shrink-0 text-sm text-[color:var(--a-text-muted)]">
						{thread.post_count} レス
					</span>
				</div>
				<div className="mt-1 flex items-center justify-between text-xs text-[color:var(--a-text-muted)]">
					<span>{authorLabel}</span>
					<time dateTime={thread.last_post_at}>
						{formatDateTime(thread.last_post_at)}
					</time>
				</div>
			</Link>
		</li>
	);
}
