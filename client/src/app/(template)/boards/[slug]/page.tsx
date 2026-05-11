/**
 * /boards/<slug> 板詳細・スレ一覧ページ (Phase 5 / Issue #432).
 *
 * SSR で板メタとスレ一覧 (1 ページ目) を取得。匿名閲覧可。
 * 未ログイン時は ThreadComposer が CTA に置換される。
 */

import type { Metadata } from "next";
import Link from "next/link";
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
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href="/boards"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 掲示板
				</Link>
				<span
					className="size-2 shrink-0 rounded-full"
					style={{ backgroundColor: board.color }}
					aria-hidden="true"
				/>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{board.name}
					</h1>
					{board.description && (
						<p
							className="truncate text-[color:var(--a-text-subtle)]"
							style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
						>
							{board.description}
						</p>
					)}
				</div>
			</header>

			<div className="p-5">
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
						<p className="text-sm text-[color:var(--a-text-muted)]">
							まだスレッドがありません。
						</p>
					) : (
						<ul
							role="list"
							className="rounded-lg border border-[color:var(--a-border)] bg-[color:var(--a-bg)]"
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
							<Link
								href={`/boards/${board.slug}?page=${page - 1}`}
								className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								style={{ color: "var(--a-accent)" }}
							>
								← 前のページ
							</Link>
						) : (
							<span />
						)}
						<span className="text-[color:var(--a-text-muted)]">
							全 {threads.count} 件
						</span>
						{threads.next ? (
							<Link
								href={`/boards/${board.slug}?page=${page + 1}`}
								className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								style={{ color: "var(--a-accent)" }}
							>
								次のページ →
							</Link>
						) : (
							<span />
						)}
					</nav>
				</section>
			</div>
		</>
	);
}
