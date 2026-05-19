/**
 * Explore / Latest timeline API helpers (P2-19 / Issue #191, #803).
 *
 * Public, no auth required. Backed by:
 *  - GET /api/v1/timeline/explore/ — 24h trending (reaction 数上位)
 *  - GET /api/v1/timeline/latest/ — 全 public tweets 最新順 (#803)
 */

import { serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";

export interface ExploreTimelinePage {
	results: TweetSummary[];
	count: number;
	next: string | null;
	previous: string | null;
}

/**
 * #803: 最新の投稿 feed は cursor-based pagination (next_cursor + has_more)。
 * 既存 ExploreTimelinePage の DRF default shape (count + next + previous) とは
 * 別 (view 実装の差異)。 explore.ts に同居しているが shape は独立。
 */
export interface LatestTimelinePage {
	results: TweetSummary[];
	next_cursor: string | null;
	has_more: boolean;
}

const DEFAULT_LIMIT = 20;

export async function fetchExploreTimeline(
	limit: number = DEFAULT_LIMIT,
): Promise<ExploreTimelinePage> {
	return serverFetch<ExploreTimelinePage>(`/timeline/explore/?limit=${limit}`);
}

/**
 * 最新の投稿 feed を取得 (#803、 /explore page の中央 column 用)。
 * cursor を渡すと次 page を取得 (本 PR では initial page のみ呼び出し、
 * infinite scroll は将来検討)。
 */
export async function fetchLatestTimeline(
	limit: number = DEFAULT_LIMIT,
	cursor: string | null = null,
): Promise<LatestTimelinePage> {
	const params = new URLSearchParams({ limit: String(limit) });
	if (cursor) params.set("cursor", cursor);
	return serverFetch<LatestTimelinePage>(
		`/timeline/latest/?${params.toString()}`,
	);
}
