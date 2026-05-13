/**
 * /search/users — 汎用ユーザー検索 page (Phase 12 P12-04)。
 *
 * spec: docs/specs/phase-12-residence-map-spec.md / phase-12 milestone #15
 *
 * - anon 閲覧可。 SSR で結果を取得。
 * - GET /api/v1/users/search/?q= の cursor pagination を消費。
 *   本 page は 1 page のみ render し、 「次の 20 件 →」 link で page 遷移。
 */

import type { Metadata } from "next";
import Link from "next/link";

import UserSearchBox from "@/components/search/UserSearchBox";
import UserSearchResultCard from "@/components/search/UserSearchResultCard";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { UserSearchPage as UserSearchPageData } from "@/lib/api/userSearch";

interface SearchPageProps {
	searchParams: { q?: string; cursor?: string };
}

export const metadata: Metadata = {
	title: "ユーザー検索 — エンジニア SNS",
	description: "ユーザー名 / 表示名 / 自己紹介で検索する。",
};

async function loadUserSearch(
	query: string,
	cursor?: string,
): Promise<UserSearchPageData> {
	const params = new URLSearchParams();
	if (query) params.set("q", query);
	if (cursor) params.set("cursor", cursor);
	const qs = params.toString();
	const url = qs ? `/users/search/?${qs}` : "/users/search/";
	try {
		return await serverFetch<UserSearchPageData>(url);
	} catch (error) {
		if (error instanceof ApiServerError) {
			return { results: [], next: null, previous: null };
		}
		throw error;
	}
}

/** cursor URL から `cursor=...` だけ抽出して相対 path にする。 */
function extractCursor(absoluteUrl: string | null): string | null {
	if (!absoluteUrl) return null;
	try {
		const u = new URL(absoluteUrl);
		return u.searchParams.get("cursor");
	} catch {
		// URL constructor が失敗するケース (相対 URL) は素朴に search を切り出す
		const m = /[?&]cursor=([^&]+)/.exec(absoluteUrl);
		return m ? decodeURIComponent(m[1]) : null;
	}
}

export default async function UserSearchPage({
	searchParams,
}: SearchPageProps) {
	const query = (searchParams.q ?? "").trim();
	const cursor = searchParams.cursor;
	const page = query
		? await loadUserSearch(query, cursor)
		: { results: [], next: null, previous: null };

	const nextCursor = extractCursor(page.next);
	const prevCursor = extractCursor(page.previous);

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
						ユーザー検索
					</h1>
					{query && (
						<p
							className="truncate text-[color:var(--a-text-subtle)]"
							style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
						>
							「{query}」
						</p>
					)}
				</div>
			</header>

			<div className="px-5 py-5">
				<div className="mb-6">
					<UserSearchBox initialValue={query} />
				</div>

				{!query && (
					<p className="text-sm text-[color:var(--a-text-muted)]">
						ユーザー名 / 表示名 / 自己紹介 (bio) で部分一致検索できます。
					</p>
				)}

				{query && page.results.length === 0 && (
					<p
						role="status"
						className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]"
					>
						「{query}」 に一致するユーザーは見つかりませんでした。
					</p>
				)}

				{query && page.results.length > 0 && (
					<section aria-label="検索結果">
						<ul role="list" className="space-y-2">
							{page.results.map((u) => (
								<UserSearchResultCard key={u.user_id} user={u} />
							))}
						</ul>

						<nav
							aria-label="ページ送り"
							className="mt-6 flex items-center justify-between text-sm"
						>
							{prevCursor ? (
								<Link
									href={`/search/users?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(prevCursor)}`}
									className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
								>
									← 前の 20 件
								</Link>
							) : (
								<span aria-hidden="true" />
							)}
							{nextCursor ? (
								<Link
									href={`/search/users?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(nextCursor)}`}
									className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
								>
									次の 20 件 →
								</Link>
							) : (
								<span aria-hidden="true" />
							)}
						</nav>
					</section>
				)}
			</div>
		</>
	);
}
