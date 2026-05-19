/**
 * Occupation API helpers (Phase 12 P12-06b, issue #818).
 *
 * Thin typed wrappers over the P12-06 backend (#815) endpoints:
 *   - GET  /api/v1/occupations/              (anon 可、 catalog)
 *   - GET  /api/v1/users/me/occupations/     (auth、 自分の slug 配列)
 *   - PUT  /api/v1/users/me/occupations/     (auth、 置換、 最大 3 件)
 *
 * spec: docs/specs/phase-12-residence-map-spec.md §9
 */

import type { AxiosInstance } from "axios";

import { api, ensureCsrfToken } from "@/lib/api/client";

/** controlled vocabulary 1 件 (catalog from /api/v1/occupations/)。 */
export interface Occupation {
	slug: string;
	display_name: string;
	display_order: number;
}

/** ``MAX_PER_USER`` (backend ``UserOccupation.MAX_PER_USER``) と同期。 */
export const OCCUPATION_MAX_PER_USER = 3;

/** SSR / CSR 両方から呼べる。 anon 可。 */
export async function fetchOccupations(
	client: AxiosInstance = api,
): Promise<Occupation[]> {
	const res = await client.get<Occupation[]>("/occupations/");
	return res.data;
}

/** 認証必須。 未認証なら null (login redirect は呼び出し側で判断)。 */
export async function fetchMyOccupations(
	client: AxiosInstance = api,
): Promise<string[] | null> {
	try {
		const res = await client.get<{ slugs: string[] }>("/users/me/occupations/");
		return res.data.slugs;
	} catch (error: unknown) {
		if (isAuthFailure(error)) return null;
		throw error;
	}
}

/**
 * Replace semantics。 server は ``{"slugs": [...]}`` を最終状態として保存する。
 *
 * - 4 件以上を渡そうとすると client 側で early throw (DB 往復前)。
 * - 重複 slug も早期 throw する。 server も 400 を返すが network を節約。
 */
export async function saveMyOccupations(
	slugs: string[],
	client: AxiosInstance = api,
): Promise<string[]> {
	if (slugs.length > OCCUPATION_MAX_PER_USER) {
		throw new Error(
			`職業は最大 ${OCCUPATION_MAX_PER_USER} 件までしか選択できません。`,
		);
	}
	if (new Set(slugs).size !== slugs.length) {
		throw new Error("同じ職業を重複して選択することはできません。");
	}

	await ensureCsrfToken(client);
	const res = await client.put<{ slugs: string[] }>("/users/me/occupations/", {
		slugs,
	});
	return res.data.slugs;
}

function isAuthFailure(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const status = (error as { response?: { status?: number } }).response?.status;
	return status === 401 || status === 403;
}
