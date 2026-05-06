/**
 * BoardCard (Phase 5 / Issue #432).
 *
 * /boards 一覧で板 1 件を表示するカード。`color` を accent stripe として使う。
 * a11y: 全体を `<a>` 化し、見出しは `<h2>`。
 */

import Link from "next/link";

import type { Board } from "@/lib/api/boards";

interface BoardCardProps {
	board: Board;
}

export default function BoardCard({ board }: BoardCardProps) {
	return (
		<Link
			href={`/boards/${board.slug}`}
			className="group flex flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-gray-700 dark:bg-gray-900"
			aria-label={`${board.name} 板`}
		>
			<div
				className="mb-3 h-1.5 w-12 rounded-full"
				style={{ backgroundColor: board.color }}
				aria-hidden="true"
			/>
			<h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 group-hover:underline">
				{board.name}
			</h2>
			{board.description && (
				<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
					{board.description}
				</p>
			)}
		</Link>
	);
}
