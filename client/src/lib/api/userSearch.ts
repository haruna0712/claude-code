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

/** P12-08: user が自分で設定した居住地の円 (中心 + 半径、 min 500m)。 未設定は null。 */
export interface UserSearchResidence {
	latitude: string;
	longitude: string;
	radius_m: number;
}

/** P12-08: 地図 Circle 配色 / popup chip 用の職業。 */
export interface UserSearchOccupation {
	slug: string;
	display_name: string;
}

export interface UserSearchResultItem {
	user_id: string;
	username: string;
	display_name: string;
	bio: string;
	avatar_url: string;
	/** P12-05: 近所検索のとき backend が返す距離 (km, 小数 2 桁)。
	 *  text 検索のみの結果では null。 */
	distance_km: number | null;
	/** P12-08: 地図 view 用。 居住地未設定の user は null (地図に出さない)。 */
	residence: UserSearchResidence | null;
	/** P12-08: 地図 Circle の配色 + popup。 未設定は空配列。 */
	occupations: UserSearchOccupation[];
}

export interface UserSearchPage {
	results: UserSearchResultItem[];
	next: string | null;
	previous: string | null;
}

/**
 * 地図に円として描けるか (P12-08)。 residence があり、 lat/lng が空でなく有限。
 *
 * 地図 wrapper (UserMapView) の「描画件数」 判定と canvas (UserMapCanvas) の実際の
 * 描画フィルタを **同じ述語** に揃えるための共有ロジック (typescript-reviewer HIGH:
 * 両者がズレると「円ゼロの空白地図」 が無説明で出る)。 leaflet を import しないので
 * server component / map canvas の双方から安全に使える。
 * ``Number("")`` が 0 を返して誤って [0,0] に置かれる罠も空文字弾きで防ぐ。
 */
export function isPlottableUser(user: UserSearchResultItem): boolean {
	const res = user.residence;
	if (!res) return false;
	if (res.latitude.trim() === "" || res.longitude.trim() === "") return false;
	return (
		Number.isFinite(Number(res.latitude)) &&
		Number.isFinite(Number(res.longitude))
	);
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
export type SearchView = "list" | "map";

export interface UserSearchQueryState {
	q?: string;
	nearMe?: boolean;
	radiusKm?: number;
	occupations?: string[];
	cursor?: string | null;
	/** P12-08: list ↔ map の表示モード。 frontend route 専用 (API は無視)。 */
	view?: SearchView;
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
	// view は frontend route の状態 (どの surface を描くか)。 backend は無視するが、
	// filter を切り替えても map/list mode を維持するため URL に載せる。 default の
	// list は URL に出さない (URL を短く保つ + 既存 link の後方互換)。
	if (state.view === "map") params.set("view", "map");
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
