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
	/** P12-07: 職業 slug で絞り込む。 複数指定は backend で OR 結合。 */
	occupations?: string[];
}

export const PROXIMITY_RADIUS_MIN_KM = 1;
export const PROXIMITY_RADIUS_MAX_KM = 100;
export const PROXIMITY_RADIUS_DEFAULT_KM = 10;

/** ``/search/users`` (frontend route) と ``/users/search/`` (API) 双方の
 *  query string を組み立てる単一の正本。 q / near_me / radius_km / occupation[] /
 *  cursor を一貫した順序・形式 (occupation は同名 key を append) で出す。
 *  これを共有することで NearMeFilter / OccupationFilter / page が filter を
 *  取りこぼさず相互に維持できる (code-reviewer HIGH: cross-filter state loss 対策)。 */
export interface UserSearchQueryState {
	q?: string;
	nearMe?: boolean;
	radiusKm?: number;
	occupations?: string[];
	cursor?: string | null;
}

export function buildUserSearchParams(
	state: UserSearchQueryState,
): URLSearchParams {
	const params = new URLSearchParams();
	const q = state.q?.trim();
	if (q) params.set("q", q);
	if (state.nearMe) {
		params.set("near_me", "1");
		params.set(
			"radius_km",
			String(state.radiusKm ?? PROXIMITY_RADIUS_DEFAULT_KM),
		);
	}
	for (const slug of state.occupations ?? []) {
		const trimmed = slug.trim();
		if (trimmed) params.append("occupation", trimmed);
	}
	if (state.cursor) params.set("cursor", state.cursor);
	return params;
}

/** frontend route href (`/search/users?...`)。 query が空なら base path のみ。 */
export function buildUserSearchHref(state: UserSearchQueryState): string {
	const qs = buildUserSearchParams(state).toString();
	return qs ? `/search/users?${qs}` : "/search/users";
}

/** ``GET /users/search/?q=`` を呼ぶ。 cursor を渡せば next/prev page。
 *
 * occupation は同名 key を繰り返す (``?occupation=a&occupation=b``) ので
 * ``Record<string,string>`` ではなく ``URLSearchParams`` で組み立てる
 * (axios の array シリアライズは ``occupation[]=`` 形式になり backend の
 * ``getlist("occupation")`` と噛み合わないため、 明示的に append する)。 */
export async function fetchUserSearch(
	query: string,
	options: UserSearchOptions = {},
	client: AxiosInstance = api,
): Promise<UserSearchPage> {
	const params = buildUserSearchParams({
		q: query,
		cursor: options.cursor,
		nearMe: options.nearMe,
		radiusKm: options.radiusKm,
		occupations: options.occupations,
	});
	const res = await client.get<UserSearchPage>("/users/search/", { params });
	return res.data;
}
