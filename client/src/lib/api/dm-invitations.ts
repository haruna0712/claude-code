/**
 * DM 招待 accept/decline の axios 呼び出しヘルパ (#489).
 *
 * `dmApiSlice` (RTK Query) は `/notifications/` ページで使われていないため、
 * NotificationsList 内から直接叩く軽量 helper を提供する。
 *
 * 既存 backend エンドポイント:
 *   POST /api/v1/dm/invitations/<id>/accept/   → 200 + GroupInvitation
 *   POST /api/v1/dm/invitations/<id>/decline/  → 200 + GroupInvitation
 */

import { api } from "@/lib/api/client";

export async function acceptInvitation(id: number): Promise<void> {
	await api.post(`/dm/invitations/${id}/accept/`);
}

export async function declineInvitation(id: number): Promise<void> {
	await api.post(`/dm/invitations/${id}/decline/`);
}
