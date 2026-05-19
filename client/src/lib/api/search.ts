/**
 * Search API helper (P2-16 / Issue #207).
 *
 * Backed by the public /api/v1/search/ endpoint (P2-11 #205, P2-12 #206).
 * No auth required. Server Components use ``fetchSearch`` directly via
 * ``serverFetch``; Client Components can fall back to the axios client
 * (not yet wired — adds a follow-up if interactive filtering is needed).
 */

import { serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";

/** #811: 検索結果 sort 切替。 latest = 新しい順、 top = 注目 (engagement 代理). */
export type SearchSort = "latest" | "top";

export interface SearchResponse {
	query: string;
	/** #811: backend が正規化した sort 値 (不正値は latest に fallback). */
	sort?: SearchSort;
	results: TweetSummary[];
	count: number;
}

const DEFAULT_LIMIT = 20;

export async function fetchSearch(
	query: string,
	limit: number = DEFAULT_LIMIT,
	sort: SearchSort = "latest",
): Promise<SearchResponse> {
	const trimmed = (query ?? "").trim();
	if (!trimmed) {
		return { query: "", sort, results: [], count: 0 };
	}
	const params = new URLSearchParams({
		q: trimmed,
		limit: String(limit),
		sort,
	});
	return serverFetch<SearchResponse>(`/search/?${params.toString()}`);
}
