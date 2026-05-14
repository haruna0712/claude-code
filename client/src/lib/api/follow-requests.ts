/**
 * #735 フォロー申請承認 API client.
 *
 * - GET  /api/v1/follows/requests/                  → 自分宛 pending 一覧
 * - POST /api/v1/follows/requests/<follow_id>/approve/ → 承認
 * - POST /api/v1/follows/requests/<follow_id>/reject/  → 拒否
 *
 * spec: docs/specs/private-account-spec.md §3.3 §3.4
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";

export interface FollowRequestRow {
	follow_id: number;
	follower: {
		id: string;
		handle: string;
		display_name: string;
		avatar_url: string;
	};
	created_at: string;
}

export interface FollowRequestListPage {
	count?: number;
	next?: string | null;
	previous?: string | null;
	results: FollowRequestRow[];
}

export async function fetchFollowRequests(
	client: AxiosInstance = api,
): Promise<FollowRequestListPage> {
	const res = await client.get<FollowRequestListPage>("/follows/requests/");
	return res.data;
}

export async function approveFollowRequest(
	followId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.post(`/follows/requests/${followId}/approve/`);
}

export async function rejectFollowRequest(
	followId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.post(`/follows/requests/${followId}/reject/`);
}
