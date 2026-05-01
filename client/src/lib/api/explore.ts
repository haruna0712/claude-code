/**
 * Explore timeline API helper (P2-19 / Issue #191).
 *
 * Public, no auth required. Backed by GET /api/v1/timeline/explore/ which
 * returns the trending public feed for unauthenticated visitors.
 */

import { serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";

export interface ExploreTimelinePage {
	results: TweetSummary[];
	count: number;
	next: string | null;
	previous: string | null;
}

const DEFAULT_LIMIT = 20;

export async function fetchExploreTimeline(
	limit: number = DEFAULT_LIMIT,
): Promise<ExploreTimelinePage> {
	return serverFetch<ExploreTimelinePage>(`/timeline/explore/?limit=${limit}`);
}
