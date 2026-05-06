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
 *
 * テストでは ``createApiClient()`` + ``MockAdapter`` を渡してモックする
 * (apps/users/tweets と同じ pattern)。
 */

import type { AxiosInstance } from "axios";

import { api } from "@/lib/api/client";
import type { PaginatedResponse } from "@/types";

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

export interface CreateThreadPayload {
	title: string;
	first_post_body: string;
	first_post_images?: ImagePayload[];
}

export interface CreateThreadPostPayload {
	body: string;
	images?: ImagePayload[];
}

export interface RequestImageUploadUrlPayload {
	content_type: string;
	content_length: number;
}

export async function fetchBoards(
	client: AxiosInstance = api,
): Promise<Board[]> {
	const res = await client.get<Board[]>("/boards/");
	return res.data;
}

export async function fetchBoard(
	slug: string,
	client: AxiosInstance = api,
): Promise<Board> {
	const res = await client.get<Board>(`/boards/${encodeURIComponent(slug)}/`);
	return res.data;
}

export async function fetchBoardThreads(
	slug: string,
	page = 1,
	client: AxiosInstance = api,
): Promise<PaginatedResponse<ThreadSummary>> {
	const res = await client.get<PaginatedResponse<ThreadSummary>>(
		`/boards/${encodeURIComponent(slug)}/threads/`,
		{ params: { page } },
	);
	return res.data;
}

export async function fetchThread(
	id: number,
	client: AxiosInstance = api,
): Promise<ThreadDetail> {
	const res = await client.get<ThreadDetail>(`/threads/${id}/`);
	return res.data;
}

export async function fetchThreadPosts(
	id: number,
	page = 1,
	client: AxiosInstance = api,
): Promise<PaginatedResponse<ThreadPost>> {
	const res = await client.get<PaginatedResponse<ThreadPost>>(
		`/threads/${id}/posts/`,
		{ params: { page } },
	);
	return res.data;
}

export async function createThread(
	slug: string,
	payload: CreateThreadPayload,
	client: AxiosInstance = api,
): Promise<ThreadCreateResponse> {
	const res = await client.post<ThreadCreateResponse>(
		`/boards/${encodeURIComponent(slug)}/threads/`,
		payload,
	);
	return res.data;
}

export async function createThreadPost(
	threadId: number,
	payload: CreateThreadPostPayload,
	client: AxiosInstance = api,
): Promise<ThreadPostWithState> {
	const res = await client.post<ThreadPostWithState>(
		`/threads/${threadId}/posts/`,
		payload,
	);
	return res.data;
}

export async function deleteThreadPost(
	postId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await client.delete(`/posts/${postId}/`);
}

export async function requestImageUploadUrl(
	payload: RequestImageUploadUrlPayload,
	client: AxiosInstance = api,
): Promise<ImageUploadUrlResponse> {
	const res = await client.post<ImageUploadUrlResponse>(
		"/boards/thread-post-images/upload-url/",
		payload,
	);
	return res.data;
}
