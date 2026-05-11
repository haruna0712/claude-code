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
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						掲示板
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						技術トピックごとに議論する場所
					</p>
				</div>
			</header>

			<div className="p-5">
				{boards.length === 0 ? (
					<p className="text-sm text-[color:var(--a-text-muted)]">
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
			</div>
		</>
	);
}
