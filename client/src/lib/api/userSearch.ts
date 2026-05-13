/**
 * 汎用ユーザー検索 API helpers (Phase 12 P12-04 / P12-05).
 *
 * Backend ``GET /api/v1/users/search/?q=&cursor=&near_me=1&radius_km=N``
 * の cursor pagination をラップする。 anon 閲覧可 (near_me は要 auth)。
 *
 * 既存の handle 前方一致 autocomplete (``/api/v1/users/?q=``、
 * `lib/api/users.ts` の ``UserSearchView``) とは別物。 こちらは検索 page 用で
 * display_name / bio も含む部分一致 + 近所検索。
 */

import type { AxiosInstance } from "axios";

import { api } from "@/lib/api/client";

export interface UserSearchResultItem {
	user_id: string;
	username: string;
	display_name: string;
	bio: string;
	avatar_url: string;
	/** P12-05: 近所検索のとき backend が返す距離 (km, 小数 2 桁)。
	 *  text 検索のみの結果では null。 */
	distance_km: number | null;
}

export interface UserSearchPage {
	results: UserSearchResultItem[];
	next: string | null;
	previous: string | null;
}

export interface UserSearchOptions {
	cursor?: string | null;
	/** P12-05: auth user の residence center で近所検索する。 */
	nearMe?: boolean;
	/** P12-05: 近所検索の半径 (km, 1〜200 で clamp は backend 側で行う)。 */
	radiusKm?: number;
}

export const PROXIMITY_RADIUS_MIN_KM = 1;
export const PROXIMITY_RADIUS_MAX_KM = 100;
export const PROXIMITY_RADIUS_DEFAULT_KM = 10;

/** ``GET /users/search/?q=`` を呼ぶ。 cursor を渡せば next/prev page。 */
export async function fetchUserSearch(
	query: string,
	options: UserSearchOptions = {},
	client: AxiosInstance = api,
): Promise<UserSearchPage> {
	const params: Record<string, string> = {};
	if (query.trim()) params.q = query.trim();
	if (options.cursor) params.cursor = options.cursor;
	if (options.nearMe) {
		params.near_me = "1";
		params.radius_km = String(options.radiusKm ?? PROXIMITY_RADIUS_DEFAULT_KM);
	}
	const res = await client.get<UserSearchPage>("/users/search/", { params });
	return res.data;
}
