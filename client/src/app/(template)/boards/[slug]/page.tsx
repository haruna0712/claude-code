/**
 * /boards/<slug> 板詳細・スレ一覧ページ (Phase 5 / Issue #432).
 *
 * SSR で板メタとスレ一覧 (1 ページ目) を取得。匿名閲覧可。
 * 未ログイン時は ThreadComposer が CTA に置換される。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import ThreadComposer from "@/components/boards/ThreadComposer";
import ThreadRow from "@/components/boards/ThreadRow";
import type { Board, ThreadSummary } from "@/lib/api/boards";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { PaginatedResponse } from "@/types";

interface PageProps {
	params: { slug: string };
	searchParams?: { page?: string };
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	try {
		const board = await serverFetch<Board>(
			`/boards/${encodeURIComponent(params.slug)}/`,
		);
		return {
			title: `${board.name} — 掲示板`,
			description: board.description || `${board.name} 板のスレッド一覧`,
		};
	} catch {
		return { title: "掲示板" };
	}
}

async function fetchData(
	slug: string,
	page: number,
): Promise<{ board: Board; threads: PaginatedResponse<ThreadSummary> } | null> {
	try {
		const board = await serverFetch<Board>(
			`/boards/${encodeURIComponent(slug)}/`,
		);
		const threads = await serverFetch<PaginatedResponse<ThreadSummary>>(
			`/boards/${encodeURIComponent(slug)}/threads/?page=${page}`,
		);
		return { board, threads };
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		return null;
	}
}

export default async function BoardDetailPage({
	params,
	searchParams,
}: PageProps) {
	const page = Math.max(1, Number(searchParams?.page ?? 1));
	const data = await fetchData(params.slug, page);
	if (!data) notFound();
	const { board, threads } = data;

	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<header className="mb-6 flex items-start gap-3">
				<div
					className="mt-2 h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: board.color }}
					aria-hidden="true"
				/>
				<div>
					<h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
						{board.name}
					</h1>
					{board.description && (
						<p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
							{board.description}
						</p>
					)}
				</div>
			</header>

			<section className="mb-6">
				<ThreadComposer
					boardSlug={board.slug}
					isAuthenticated={isAuthenticated}
				/>
			</section>

			<section aria-labelledby="thread-list-heading">
				<h2 id="thread-list-heading" className="sr-only">
					スレッド一覧
				</h2>
				{threads.count === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">
						まだスレッドがありません。
					</p>
				) : (
					<ul
						role="list"
						className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
					>
						{threads.results.map((t) => (
							<ThreadRow key={t.id} thread={t} />
						))}
					</ul>
				)}

				<nav
					aria-label="ページネーション"
					className="mt-4 flex items-center justify-between text-sm"
				>
					{threads.previous ? (
						<a
							href={`/boards/${board.slug}?page=${page - 1}`}
							className="text-blue-600 hover:underline dark:text-blue-400"
						>
							← 前のページ
						</a>
					) : (
						<span />
					)}
					<span className="text-gray-500 dark:text-gray-400">
						全 {threads.count} 件
					</span>
					{threads.next ? (
						<a
							href={`/boards/${board.slug}?page=${page + 1}`}
							className="text-blue-600 hover:underline dark:text-blue-400"
						>
							次のページ →
						</a>
					) : (
						<span />
					)}
				</nav>
			</section>
		</main>
	);
}
