/**
 * /search page (P2-16 / Issue #207).
 *
 * 仕様: docs/specs/search-spec.md §4.1
 *
 * - Server Component が ?q を読み /api/v1/search/ を呼ぶ。
 * - 結果カードは TweetCardList (Client Component) に委譲。/explore /tag /u と
 *   同じ rendering pipeline。
 * - #372 修正: 旧 inline article + dangerouslySetInnerHTML 経路は SSR で
 *   isomorphic-dompurify (jsdom 依存) が落ちて 500 を返していた。
 *   TweetCardList で client 側 sanitize に統一して解消。副次的に結果カード
 *   からも reaction / repost / quote / reply の action button が動く。
 */

import type { Metadata } from "next";

import SearchBox from "@/components/search/SearchBox";
import TweetCardList from "@/components/timeline/TweetCardList";
import { fetchSearch } from "@/lib/api/search";
import { serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";

async function loadCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch {
		return null;
	}
}

interface SearchPageProps {
	searchParams: { q?: string };
}

export const metadata: Metadata = {
	title: "検索 — エンジニア SNS",
	description:
		"ツイートを検索する。tag:/from:/since:/until:/type:/has: のフィルタ演算子に対応。",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
	const query = (searchParams.q ?? "").trim();
	const [data, currentUser] = await Promise.all([
		query
			? fetchSearch(query).catch(() => ({
					query,
					results: [],
					count: 0,
				}))
			: Promise.resolve({ query: "", results: [], count: 0 }),
		loadCurrentUser(),
	]);

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
						検索
					</h1>
					{query && (
						<p
							className="truncate text-[color:var(--a-text-subtle)]"
							style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
						>
							「{query}」 — {data.count} 件
						</p>
					)}
				</div>
			</header>

			<div className="px-5 py-5">
				<div className="mb-6">
					<SearchBox initialValue={query} />
				</div>

				{!query && (
					<p className="text-sm text-[color:var(--a-text-muted)]">
						上のボックスにキーワードを入れて検索してください。
					</p>
				)}

				{query && (
					<section aria-label="検索結果" className="space-y-3">
						<TweetCardList
							tweets={data.results}
							ariaLabel={`「${query}」の検索結果`}
							emptyMessage="一致するツイートはありません。"
							currentUserHandle={currentUser?.username}
							currentUserPreferredLanguage={currentUser?.preferred_language}
							currentUserAutoTranslate={currentUser?.auto_translate}
						/>
					</section>
				)}
			</div>
		</>
	);
}
