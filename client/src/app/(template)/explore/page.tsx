/**
 * /explore — discovery surface for both anonymous AND authenticated visitors.
 *
 * Spec: docs/specs/explore-latest-feed-spec.md, explore-search-chrome-unify-spec.md
 *
 * 構成 (#806 で /search と統合):
 *   - chrome (header h1 「検索」 + 件数 + tabs + 説明 + box + フィルタ) は /search と同一
 *   - 中央 投稿リスト:
 *     - q あり: 検索結果 (GET /api/v1/search/)
 *     - q なし: 「最新の投稿」 feed (GET /api/v1/timeline/latest/)
 *
 * URL と chrome の関係 (ハルナさん指示 2026-05-19):
 *   - /explore と /search は **投稿リスト以外完全に同じ surface**
 *   - URL が違うだけで挙動は同じ → どちらの URL でも q ありなら検索結果、 q なしなら 最新の投稿
 *   - shared component: `SearchExploreSurface`
 */

import type { Metadata } from "next";

import SearchExploreSurface from "@/components/search/SearchExploreSurface";
import { fetchLatestTimeline } from "@/lib/api/explore";
import { fetchSearch } from "@/lib/api/search";
import { serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";
import { stringifyJsonLd } from "@/lib/json-ld";

export const metadata: Metadata = {
	title: "探索 — エンジニア SNS",
	description:
		"最新の投稿を時系列で眺め、 ツイート・タグ・ユーザーを検索する discovery surface。",
	openGraph: {
		title: "探索 — エンジニア SNS",
		description:
			"最新の投稿を時系列で眺め、 ツイート・タグ・ユーザーを検索する discovery surface。",
		type: "website",
	},
};

const websiteJsonLd = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "エンジニア SNS",
	description:
		"エンジニアによる、エンジニアのための SNS。技術タグ・コードスニペット・記事・掲示板を 1 箇所に。",
	inLanguage: "ja",
};

async function loadCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch {
		return null;
	}
}

interface ExplorePageProps {
	searchParams: { q?: string };
}

export default async function ExplorePage({ searchParams }: ExplorePageProps) {
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
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: stringifyJsonLd(websiteJsonLd) }}
			/>
			<SearchExploreSurface
				query={query}
				searchCount={searchData.count}
				searchResults={searchData.results}
				latestTweets={latestData.results}
				currentUser={currentUser}
			/>
		</>
	);
}
