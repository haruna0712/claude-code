/**
 * /search page (P2-16 / Issue #207, refactored #806).
 *
 * 仕様: docs/specs/search-spec.md §4.1, docs/specs/explore-search-chrome-unify-spec.md
 *
 * #806 で /explore と chrome を統一: SearchExploreSurface shared component を
 * 使う。 q ありなら検索結果、 q なしなら 「最新の投稿」 feed を表示。
 *
 * - Server Component が ?q を読み /api/v1/search/ (q ありのみ) と
 *   /api/v1/timeline/latest/ (q なしフォールバック) を呼ぶ。
 * - 結果カードは TweetCardList (Client Component) に委譲。
 */

import type { Metadata } from "next";

import SearchExploreSurface from "@/components/search/SearchExploreSurface";
import { fetchLatestTimeline } from "@/lib/api/explore";
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
	const [searchData, latestData, currentUser] = await Promise.all([
		query
			? fetchSearch(query).catch(() => ({
					query,
					results: [],
					count: 0,
				}))
			: Promise.resolve({ query: "", results: [], count: 0 }),
		query
			? Promise.resolve({ results: [], next_cursor: null, has_more: false })
			: fetchLatestTimeline(20).catch(() => ({
					results: [],
					next_cursor: null,
					has_more: false,
				})),
		loadCurrentUser(),
	]);

	return (
		<SearchExploreSurface
			query={query}
			searchCount={searchData.count}
			searchResults={searchData.results}
			latestTweets={latestData.results}
			currentUser={currentUser}
		/>
	);
}
