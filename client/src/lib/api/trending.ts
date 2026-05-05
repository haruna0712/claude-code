/**
 * Sidebar API helpers (P2-17 / Issue #189, fix #390).
 *
 * Trending tags + Who-to-follow user lists feed the right-rail sidebar.
 * Endpoints accept either a plain array or a paginated `{ results: [...] }`
 * envelope, so consumers stay agnostic.
 *
 * #390: backend は per-row も `{user: {...}, reason: ...}` で wrap している
 * ため二段階 unwrap が必要。本 helper で flatten する。
 *
 * 仕様: docs/specs/recommended-users-spec.md
 */

import type { AxiosInstance } from "axios";
import { api } from "@/lib/api/client";

export interface TrendingTag {
	rank: number;
	name: string;
	display_name: string;
	uses: number;
	emoji?: string;
}

export interface SidebarUser {
	id?: string;
	handle: string;
	display_name: string;
	avatar_url?: string;
	bio?: string;
	followers_count?: number;
	is_following?: boolean;
	reason?: string;
}

interface MaybePaginated<T> {
	results?: T[];
}

/**
 * #390: backend の per-row wrapper `{user: {...}, reason: ...}` を flatten する.
 * 既に flat (テストの mock 等) で来た場合はそのまま返す。
 */
function flattenSidebarUser(row: unknown): SidebarUser {
	if (
		row !== null &&
		typeof row === "object" &&
		"user" in row &&
		typeof (row as { user: unknown }).user === "object" &&
		(row as { user: unknown }).user !== null
	) {
		const wrapped = row as {
			user: Record<string, unknown>;
			reason?: unknown;
		};
		return {
			...(wrapped.user as Partial<SidebarUser>),
			reason: typeof wrapped.reason === "string" ? wrapped.reason : undefined,
		} as SidebarUser;
	}
	return row as SidebarUser;
}

/**
 * #390: reason short-string → 日本語ラベルへの mapping.
 * 未知値は forward-compat のためそのまま表示。
 */
const REASON_LABELS: Record<string, string> = {
	recent_reaction: "最近リアクションした投稿者",
	popular: "フォロワーが多い",
};

export function localizeReason(reason: string | undefined): string | undefined {
	if (!reason) return undefined;
	return REASON_LABELS[reason] ?? reason;
}

function unwrap<T>(data: T[] | MaybePaginated<T>): T[] {
	if (Array.isArray(data)) return data;
	return data.results ?? [];
}

export async function fetchTrendingTags(
	client: AxiosInstance = api,
): Promise<TrendingTag[]> {
	const res = await client.get<TrendingTag[] | MaybePaginated<TrendingTag>>(
		"/tags/trending/",
	);
	return unwrap(res.data);
}

export async function fetchRecommendedUsers(
	limit: number,
	client: AxiosInstance = api,
): Promise<SidebarUser[]> {
	const res = await client.get<unknown[] | MaybePaginated<unknown>>(
		"/users/recommended/",
		{ params: { limit } },
	);
	return unwrap<unknown>(res.data).map(flattenSidebarUser);
}

export async function fetchPopularUsers(
	limit: number,
	client: AxiosInstance = api,
): Promise<SidebarUser[]> {
	const res = await client.get<unknown[] | MaybePaginated<unknown>>(
		"/users/popular/",
		{ params: { limit } },
	);
	return unwrap<unknown>(res.data).map(flattenSidebarUser);
}
