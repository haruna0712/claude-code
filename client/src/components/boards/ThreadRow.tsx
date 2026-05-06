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
		<li className="border-b border-gray-200 dark:border-gray-700">
			<Link
				href={`/threads/${thread.id}`}
				className="block px-4 py-3 transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:hover:bg-gray-800"
				aria-label={`${thread.title} (${thread.post_count} レス)`}
			>
				<div className="flex items-center justify-between gap-3">
					<h3 className="flex-1 truncate text-base font-medium text-gray-900 dark:text-gray-100">
						{thread.title}
						{thread.locked && (
							<span
								className="ml-2 inline-block rounded bg-gray-200 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
								aria-label="ロック済"
							>
								🔒
							</span>
						)}
					</h3>
					<span className="shrink-0 text-sm text-gray-500 dark:text-gray-400">
						{thread.post_count} レス
					</span>
				</div>
				<div className="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
					<span>{authorLabel}</span>
					<time dateTime={thread.last_post_at}>
						{formatDateTime(thread.last_post_at)}
					</time>
				</div>
			</Link>
		</li>
	);
}
