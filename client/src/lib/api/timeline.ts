/**
 * Timeline API helpers (P2-13 / Issue #186).
 *
 * Provides server-fetched home and following timelines.
 * These endpoints are consumed by HomeFeed (Client Component) via axios,
 * and by page.tsx (Server Component) via serverFetch.
 */

import type { AxiosInstance } from "axios";
import { api } from "@/lib/api/client";
import type { TweetSummary } from "@/lib/api/tweets";

export type { TweetSummary } from "@/lib/api/tweets";

export interface TimelinePage {
	results: TweetSummary[];
}

export interface HomeTimelinePage extends TimelinePage {
	cache_hit: boolean;
}

/**
 * Fetch the home (recommended) timeline.
 * GET /api/v1/timeline/home/?limit=N
 */
export async function fetchHomeTimeline(
	limit: number,
	client: AxiosInstance = api,
): Promise<HomeTimelinePage> {
	const res = await client.get<HomeTimelinePage>("/timeline/home/", {
		params: { limit },
	});
	return res.data;
}

/**
 * Fetch the following timeline.
 * GET /api/v1/timeline/following/?limit=N
 */
export async function fetchFollowingTimeline(
	limit: number,
	client: AxiosInstance = api,
): Promise<TimelinePage> {
	const res = await client.get<TimelinePage>("/timeline/following/", {
		params: { limit },
	});
	return res.data;
}
