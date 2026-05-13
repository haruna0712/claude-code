/**
 * 汎用ユーザー検索 API helpers (Phase 12 P12-04).
 *
 * Backend P12-04 spec §4.5 通り、 ``GET /api/v1/users/search/?q=&cursor=``
 * の cursor pagination をラップする。 anon 閲覧可。
 *
 * 既存の handle 前方一致 autocomplete (``/api/v1/users/?q=``、
 * `lib/api/users.ts` の ``UserSearchView``) とは別物。 こちらは検索 page 用で
 * display_name / bio も含む部分一致。
 */

import type { AxiosInstance } from "axios";

import { api } from "@/lib/api/client";

export interface UserSearchResultItem {
	user_id: string;
	username: string;
	display_name: string;
	bio: string;
	avatar_url: string;
}

export interface UserSearchPage {
	results: UserSearchResultItem[];
	next: string | null;
	previous: string | null;
}

/** ``GET /users/search/?q=`` を呼ぶ。 cursor を渡せば next/prev page。 */
export async function fetchUserSearch(
	query: string,
	options: { cursor?: string | null } = {},
	client: AxiosInstance = api,
): Promise<UserSearchPage> {
	const params: Record<string, string> = {};
	if (query.trim()) params.q = query.trim();
	if (options.cursor) params.cursor = options.cursor;
	const res = await client.get<UserSearchPage>("/users/search/", { params });
	return res.data;
}
