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
	const data = query
		? await fetchSearch(query).catch(() => ({
				query,
				results: [],
				count: 0,
			}))
		: { query: "", results: [], count: 0 };

	return (
		<main className="mx-auto max-w-3xl px-4 py-6">
			<header className="mb-6">
				<h1 className="mb-3 text-xl font-semibold text-foreground">検索</h1>
				<SearchBox initialValue={query} />
			</header>

			{!query && (
				<p className="text-sm text-muted-foreground">
					上のボックスにキーワードを入れて検索してください。
				</p>
			)}

			{query && (
				<section aria-label="検索結果" className="space-y-3">
					<p className="text-sm text-muted-foreground">
						「{query}」の検索結果: {data.count} 件
					</p>
					<TweetCardList
						tweets={data.results}
						ariaLabel={`「${query}」の検索結果`}
						emptyMessage="一致するツイートはありません。"
					/>
				</section>
			)}
		</main>
	);
}
