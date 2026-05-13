/**
 * UserResidence API helpers (Phase 12 P12-02).
 *
 * Thin typed wrappers over ``/api/v1/users/{me,<handle>}/residence/`` (P12-01 backend).
 * 緯度経度は ``string`` (Django DecimalField の serialize 形) で返ってくるため、
 * 表示前に Number 化する責務は呼び出し側 (Leaflet component) に持たせる。
 */

import type { AxiosInstance } from "axios";

import { api, ensureCsrfToken } from "@/lib/api/client";

/**
 * 居住地表現のサーバ shape。 backend P12-01 spec §4 通り、 半径は m 単位 (整数)。
 * latitude / longitude は DRF DecimalField 由来で string で運ばれる点に注意。
 */
export interface UserResidence {
	latitude: string;
	longitude: string;
	radius_m: number;
	updated_at: string;
}

export interface UserResidenceWrite {
	latitude: number | string;
	longitude: number | string;
	radius_m: number;
}

/** P12-01 で enforce している min/max radius。 UI slider と同期する。 */
export const RESIDENCE_MIN_RADIUS_M = 500;
export const RESIDENCE_MAX_RADIUS_M = 50_000;

/** 未設定なら null を返す (404 を null に正規化)。 */
export async function fetchMyResidence(
	client: AxiosInstance = api,
): Promise<UserResidence | null> {
	try {
		const res = await client.get<UserResidence>("/users/me/residence/");
		return res.data;
	} catch (error: unknown) {
		if (isApiNotFound(error)) return null;
		throw error;
	}
}

export async function saveMyResidence(
	payload: UserResidenceWrite,
	client: AxiosInstance = api,
): Promise<UserResidence> {
	await ensureCsrfToken(client);
	const res = await client.patch<UserResidence>(
		"/users/me/residence/",
		payload,
	);
	return res.data;
}

export async function deleteMyResidence(
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete("/users/me/residence/");
}

function isApiNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const maybeAxios = error as { response?: { status?: number } };
	return maybeAxios.response?.status === 404;
}
