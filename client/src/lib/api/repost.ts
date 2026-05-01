/**
 * Repost / Quote / Reply API helpers (P2-15 / Issue #188).
 *
 * Backend (P2-06 #181):
 *   POST   /api/v1/tweets/<id>/repost/   → idempotent create (200/201)
 *   DELETE /api/v1/tweets/<id>/repost/   → undo
 *   POST   /api/v1/tweets/<id>/quote/    → body, tags, images (TweetCreateSerializer)
 *   POST   /api/v1/tweets/<id>/reply/    → body, tags, images
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";
import type { TweetSummary } from "@/lib/api/tweets";

export interface RepostResult {
	id: number;
	repost_of: number;
	created: boolean;
}

export async function repostTweet(
	tweetId: number | string,
	client: AxiosInstance = api,
): Promise<RepostResult> {
	await ensureCsrfToken(client);
	const res = await client.post<RepostResult>(`/tweets/${tweetId}/repost/`);
	return res.data;
}

export async function unrepostTweet(
	tweetId: number | string,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete(`/tweets/${tweetId}/repost/`);
}

export interface QuoteOrReplyPayload {
	body: string;
	tags?: string[];
}

export async function quoteTweet(
	tweetId: number | string,
	payload: QuoteOrReplyPayload,
	client: AxiosInstance = api,
): Promise<TweetSummary> {
	await ensureCsrfToken(client);
	const res = await client.post<TweetSummary>(
		`/tweets/${tweetId}/quote/`,
		payload,
	);
	return res.data;
}

export async function replyToTweet(
	tweetId: number | string,
	payload: QuoteOrReplyPayload,
	client: AxiosInstance = api,
): Promise<TweetSummary> {
	await ensureCsrfToken(client);
	const res = await client.post<TweetSummary>(
		`/tweets/${tweetId}/reply/`,
		payload,
	);
	return res.data;
}
