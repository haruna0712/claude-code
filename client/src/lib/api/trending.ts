/**
 * Sidebar API helpers (P2-17 / Issue #189).
 *
 * Trending tags + Who-to-follow user lists feed the right-rail sidebar.
 * Endpoints accept either a plain array or a paginated `{ results: [...] }`
 * envelope, so consumers stay agnostic.
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
	handle: string;
	display_name: string;
	avatar_url?: string;
	bio?: string;
	is_following?: boolean;
	reason?: string;
}

interface MaybePaginated<T> {
	results?: T[];
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
	const res = await client.get<SidebarUser[] | MaybePaginated<SidebarUser>>(
		"/users/recommended/",
		{ params: { limit } },
	);
	return unwrap(res.data);
}

export async function fetchPopularUsers(
	limit: number,
	client: AxiosInstance = api,
): Promise<SidebarUser[]> {
	const res = await client.get<SidebarUser[] | MaybePaginated<SidebarUser>>(
		"/users/popular/",
		{ params: { limit } },
	);
	return unwrap(res.data);
}
