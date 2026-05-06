/**
 * /boards 板一覧ページ (Phase 5 / Issue #432).
 *
 * SSR で板一覧を取得。匿名でも閲覧可。
 * SPEC §16.2: 未ログインで閲覧可能 (CloudFront 配信キャッシュ可)。
 */

import type { Metadata } from "next";

import BoardCard from "@/components/boards/BoardCard";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { Board } from "@/lib/api/boards";

export const metadata: Metadata = {
	title: "掲示板 — エンジニア SNS",
	description: "技術トピックごとの掲示板。スレッドを立てて議論しよう。",
};

async function fetchBoardsSSR(): Promise<Board[]> {
	try {
		return await serverFetch<Board[]>("/boards/");
	} catch (err) {
		// 401 だけ拾って空配列。そもそも匿名でも 200 が返るので 5xx 等は配列を空に。
		if (err instanceof ApiServerError) return [];
		return [];
	}
}

export default async function BoardsListPage() {
	const boards = await fetchBoardsSSR();

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<header className="mb-6">
				<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
					掲示板
				</h1>
				<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
					技術トピックごとに議論する場所です。誰でも閲覧でき、ログインすればスレッドやレスを投稿できます。
				</p>
			</header>

			{boards.length === 0 ? (
				<p className="text-sm text-gray-500 dark:text-gray-400">
					まだ板がありません。
				</p>
			) : (
				<ul role="list" className="grid gap-3 sm:grid-cols-2">
					{boards.map((b) => (
						<li key={b.slug}>
							<BoardCard board={b} />
						</li>
					))}
				</ul>
			)}
		</main>
	);
}
