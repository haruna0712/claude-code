/**
 * Favorites (お気に入り) API helpers for #499.
 *
 * Backend (apps/boxes, prefix `/api/v1/boxes/`):
 *   GET    /folders/                       自分の folder 一覧 (フラット)
 *   POST   /folders/                       新規 folder (name, parent_id?)
 *   GET    /folders/<id>/                  単一 folder
 *   PATCH  /folders/<id>/                  rename / move
 *   DELETE /folders/<id>/                  CASCADE 削除
 *   GET    /folders/<id>/bookmarks/        フォルダ内 bookmark 一覧
 *   POST   /bookmarks/                     追加 (idempotent: 200/201)
 *   DELETE /bookmarks/<id>/                削除
 *   GET    /tweets/<id>/status/            自分の保存状況 (folder_ids[])
 *
 * 全 endpoint 認証必須。他人の folder/bookmark への操作は 404 隠蔽。
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";
import type { TweetSummary } from "@/lib/api/tweets";

export interface Folder {
	id: number;
	name: string;
	parent_id: number | null;
	bookmark_count: number;
	child_count: number;
	created_at: string;
	updated_at: string;
}

export interface Bookmark {
	id: number;
	tweet_id: number;
	folder_id: number;
	created_at: string;
}

export interface BookmarkStatus {
	folder_ids: number[];
}

interface FolderListResponse {
	results: Folder[];
}

interface BookmarkListResponse {
	results: Bookmark[];
	next: string | null;
	previous: string | null;
}

export async function listFolders(
	client: AxiosInstance = api,
): Promise<Folder[]> {
	const res = await client.get<FolderListResponse>("/boxes/folders/");
	return res.data.results;
}

export interface CreateFolderInput {
	name: string;
	parent_id?: number | null;
}

export async function createFolder(
	input: CreateFolderInput,
	client: AxiosInstance = api,
): Promise<Folder> {
	await ensureCsrfToken(client);
	const res = await client.post<Folder>("/boxes/folders/", input);
	return res.data;
}

export interface UpdateFolderInput {
	name?: string;
	parent_id?: number | null;
}

export async function updateFolder(
	folderId: number,
	input: UpdateFolderInput,
	client: AxiosInstance = api,
): Promise<Folder> {
	await ensureCsrfToken(client);
	const res = await client.patch<Folder>(`/boxes/folders/${folderId}/`, input);
	return res.data;
}

export async function deleteFolder(
	folderId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete(`/boxes/folders/${folderId}/`);
}

export async function listFolderBookmarks(
	folderId: number,
	client: AxiosInstance = api,
): Promise<Bookmark[]> {
	const res = await client.get<BookmarkListResponse>(
		`/boxes/folders/${folderId}/bookmarks/`,
	);
	return res.data.results;
}

export interface CreateBookmarkInput {
	folder_id: number;
	tweet_id: number;
}

export interface CreateBookmarkResult {
	bookmark: Bookmark;
	created: boolean;
}

export async function createBookmark(
	input: CreateBookmarkInput,
	client: AxiosInstance = api,
): Promise<CreateBookmarkResult> {
	await ensureCsrfToken(client);
	const res = await client.post<Bookmark>("/boxes/bookmarks/", input);
	return { bookmark: res.data, created: res.status === 201 };
}

export async function deleteBookmark(
	bookmarkId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete(`/boxes/bookmarks/${bookmarkId}/`);
}

export async function getTweetBookmarkStatus(
	tweetId: number | string,
	client: AxiosInstance = api,
): Promise<BookmarkStatus> {
	const res = await client.get<BookmarkStatus>(
		`/boxes/tweets/${tweetId}/status/`,
	);
	return res.data;
}

/** server fetch (Server Components) で folder + bookmark を取る用. */
export type { TweetSummary };
