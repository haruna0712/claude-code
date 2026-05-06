/**
 * Boards API helpers (Phase 5 / Issue #432-#434).
 *
 * 仕様: docs/specs/boards-spec.md §3.
 *
 * Endpoints:
 * - GET    /api/v1/boards/                                 → 板一覧 (匿名 OK)
 * - GET    /api/v1/boards/<slug>/                          → 板詳細
 * - GET    /api/v1/boards/<slug>/threads/?page=N           → スレ一覧
 * - POST   /api/v1/boards/<slug>/threads/                  → スレ作成 (auth)
 * - GET    /api/v1/threads/<id>/                           → スレ詳細
 * - GET    /api/v1/threads/<id>/posts/?page=N              → レス一覧
 * - POST   /api/v1/threads/<id>/posts/                     → レス作成 (auth)
 * - DELETE /api/v1/posts/<id>/                             → レス削除 (本人 + admin)
 * - POST   /api/v1/boards/thread-post-images/upload-url/   → 画像 presigned URL
 */

import type { PaginatedResponse } from "@/types";

import { api } from "@/lib/api/client";

export interface Board {
	slug: string;
	name: string;
	description: string;
	order: number;
	color: string;
}

export interface AuthorMini {
	handle: string;
	display_name: string;
	avatar_url: string;
}

export interface ThreadState {
	post_count: number;
	locked: boolean;
	approaching_limit: boolean;
}

export interface ThreadSummary {
	id: number;
	board: string;
	title: string;
	author: AuthorMini | null;
	post_count: number;
	last_post_at: string;
	locked: boolean;
	is_deleted: boolean;
	created_at: string;
}

export interface ThreadDetail extends ThreadSummary {
	thread_state: ThreadState;
}

export interface ThreadPostImage {
	image_url: string;
	width: number;
	height: number;
	order: number;
}

export interface ThreadPost {
	id: number;
	thread: number;
	number: number;
	author: AuthorMini | null;
	body: string;
	images: ThreadPostImage[];
	is_deleted: boolean;
	created_at: string;
	updated_at: string;
}

export interface ThreadPostWithState extends ThreadPost {
	thread_state: ThreadState;
}

export interface ThreadCreateResponse extends ThreadSummary {
	first_post: ThreadPost;
	thread_state: ThreadState;
}

export interface ImageUploadUrlResponse {
	upload_url: string;
	object_key: string;
	expires_at: string;
	public_url: string;
}

export interface ImagePayload {
	image_url: string;
	width: number;
	height: number;
	order: number;
}

// ---------------------------------------------------------------------------
// 一覧 / 詳細 (browser axios — 匿名でも叩ける)
// ---------------------------------------------------------------------------

export async function fetchBoards(): Promise<Board[]> {
	const res = await api.get<Board[]>("/boards/");
	return res.data;
}

export async function fetchBoard(slug: string): Promise<Board> {
	const res = await api.get<Board>(`/boards/${encodeURIComponent(slug)}/`);
	return res.data;
}

export async function fetchBoardThreads(
	slug: string,
	page = 1,
): Promise<PaginatedResponse<ThreadSummary>> {
	const res = await api.get<PaginatedResponse<ThreadSummary>>(
		`/boards/${encodeURIComponent(slug)}/threads/`,
		{ params: { page } },
	);
	return res.data;
}

export async function fetchThread(id: number): Promise<ThreadDetail> {
	const res = await api.get<ThreadDetail>(`/threads/${id}/`);
	return res.data;
}

export async function fetchThreadPosts(
	id: number,
	page = 1,
): Promise<PaginatedResponse<ThreadPost>> {
	const res = await api.get<PaginatedResponse<ThreadPost>>(
		`/threads/${id}/posts/`,
		{ params: { page } },
	);
	return res.data;
}

// ---------------------------------------------------------------------------
// 書き込み系 (auth)
// ---------------------------------------------------------------------------

export interface CreateThreadPayload {
	title: string;
	first_post_body: string;
	first_post_images?: ImagePayload[];
}

export async function createThread(
	slug: string,
	payload: CreateThreadPayload,
): Promise<ThreadCreateResponse> {
	const res = await api.post<ThreadCreateResponse>(
		`/boards/${encodeURIComponent(slug)}/threads/`,
		payload,
	);
	return res.data;
}

export interface CreateThreadPostPayload {
	body: string;
	images?: ImagePayload[];
}

export async function createThreadPost(
	threadId: number,
	payload: CreateThreadPostPayload,
): Promise<ThreadPostWithState> {
	const res = await api.post<ThreadPostWithState>(
		`/threads/${threadId}/posts/`,
		payload,
	);
	return res.data;
}

export async function deleteThreadPost(postId: number): Promise<void> {
	await api.delete(`/posts/${postId}/`);
}

// ---------------------------------------------------------------------------
// 画像 presigned URL
// ---------------------------------------------------------------------------

export interface RequestImageUploadUrlPayload {
	content_type: string;
	content_length: number;
}

export async function requestImageUploadUrl(
	payload: RequestImageUploadUrlPayload,
): Promise<ImageUploadUrlResponse> {
	const res = await api.post<ImageUploadUrlResponse>(
		"/boards/thread-post-images/upload-url/",
		payload,
	);
	return res.data;
}
