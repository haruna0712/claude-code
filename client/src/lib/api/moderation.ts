/**
 * Moderation API helpers (Phase 4B / Issue #451).
 *
 * 仕様: docs/specs/moderation-spec.md §4.
 *
 * Endpoints:
 * - GET    /api/v1/moderation/blocks/                   → 自分のブロック一覧
 * - POST   /api/v1/moderation/blocks/                   → ブロック作成
 * - DELETE /api/v1/moderation/blocks/<handle>/          → ブロック解除
 * - GET    /api/v1/moderation/mutes/                    → ミュート一覧
 * - POST   /api/v1/moderation/mutes/                    → ミュート作成
 * - DELETE /api/v1/moderation/mutes/<handle>/           → ミュート解除
 * - POST   /api/v1/moderation/reports/                  → 通報送信
 *
 * boards.ts と同パターン: AxiosInstance optional 引数で MockAdapter テスト可。
 */

import type { AxiosInstance } from "axios";

import { api } from "@/lib/api/client";
import type { PaginatedResponse } from "@/types";

export interface ModerationUserMini {
	handle: string;
	display_name: string;
	avatar_url: string;
}

export interface BlockEntry {
	blocker_handle: string;
	blockee_handle: string;
	blockee: ModerationUserMini;
	created_at: string;
}

export interface MuteEntry {
	muter_handle: string;
	mutee_handle: string;
	mutee: ModerationUserMini;
	created_at: string;
}

export type ReportTargetType =
	| "tweet"
	| "article"
	| "message"
	| "thread_post"
	| "user";

export type ReportReason =
	| "spam"
	| "abuse"
	| "copyright"
	| "inappropriate"
	| "other";

export interface ReportPayload {
	target_type: ReportTargetType;
	target_id: string;
	reason: ReportReason;
	note?: string;
}

export interface ReportResponse {
	id: string;
	status: "pending" | "resolved" | "dismissed";
	created_at: string;
}

// ---------------------------------------------------------------------------
// Block
// ---------------------------------------------------------------------------

export async function listBlocks(
	client: AxiosInstance = api,
): Promise<PaginatedResponse<BlockEntry>> {
	const res = await client.get<PaginatedResponse<BlockEntry>>(
		"/moderation/blocks/",
	);
	return res.data;
}

export async function blockUser(
	target_handle: string,
	client: AxiosInstance = api,
): Promise<BlockEntry> {
	const res = await client.post<BlockEntry>("/moderation/blocks/", {
		target_handle,
	});
	return res.data;
}

export async function unblockUser(
	target_handle: string,
	client: AxiosInstance = api,
): Promise<void> {
	await client.delete(
		`/moderation/blocks/${encodeURIComponent(target_handle)}/`,
	);
}

// ---------------------------------------------------------------------------
// Mute
// ---------------------------------------------------------------------------

export async function listMutes(
	client: AxiosInstance = api,
): Promise<PaginatedResponse<MuteEntry>> {
	const res =
		await client.get<PaginatedResponse<MuteEntry>>("/moderation/mutes/");
	return res.data;
}

export async function muteUser(
	target_handle: string,
	client: AxiosInstance = api,
): Promise<MuteEntry> {
	const res = await client.post<MuteEntry>("/moderation/mutes/", {
		target_handle,
	});
	return res.data;
}

export async function unmuteUser(
	target_handle: string,
	client: AxiosInstance = api,
): Promise<void> {
	await client.delete(
		`/moderation/mutes/${encodeURIComponent(target_handle)}/`,
	);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function submitReport(
	payload: ReportPayload,
	client: AxiosInstance = api,
): Promise<ReportResponse> {
	const res = await client.post<ReportResponse>(
		"/moderation/reports/",
		payload,
	);
	return res.data;
}
