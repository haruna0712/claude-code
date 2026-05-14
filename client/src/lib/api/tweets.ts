/**
 * Tweet CRUD API helpers (P1-16 / Issue #117).
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";
import type { ReactionAggregate } from "@/lib/api/reactions";

export interface TweetImagePayload {
	image_url: string;
	width: number;
	height: number;
	order?: number;
}

export interface CreateTweetPayload {
	body: string;
	tags?: string[];
	images?: TweetImagePayload[];
}

/** Tweet kind 4 種 (TweetType TextChoices: lowercase value)。 */
export type TweetKind = "original" | "reply" | "repost" | "quote";

/**
 * #324: 親 tweet (reply_to / quote_of / repost_of) を nested で受け取る型。
 * backend `TweetMiniSerializer` と一対一。
 */
export interface TweetMini {
	id: number;
	author_handle: string;
	author_display_name?: string;
	author_avatar_url?: string;
	body: string;
	html?: string;
	char_count?: number;
	/**
	 * P13-01: 自動検出された言語コード (ISO 639-1)。
	 * 検出不可 / 短文の場合は null。 翻訳 button の表示判定に使う。
	 */
	language?: string | null;
	created_at: string;
	edit_count?: number;
	last_edited_at?: string | null;
	images?: TweetImagePayload[];
	tags?: string[];
	type?: TweetKind;
	is_deleted: boolean;
	reply_count?: number;
	repost_count?: number;
	quote_count?: number;
	reaction_count?: number;
	/** #383: reaction kind 別集計 + viewer 別 my_kind. */
	reaction_summary?: ReactionAggregate;
	quote_of?: TweetMini | null;
	reposted_by_me?: boolean;
}

export interface TweetSummary {
	id: number;
	body: string;
	html: string;
	char_count: number;
	author_handle: string;
	author_display_name?: string;
	author_avatar_url?: string;
	tags: string[];
	images: TweetImagePayload[];
	created_at: string;
	updated_at: string;
	edit_count: number;
	// #324 (Closes #323 backend changes 経由): UI 分岐 + counts + nested parent.
	// 旧 backend (この PR 前) はこれらを返さないので optional にしている。
	// PR #328 (X-1) merge 後は server から必ず付与される想定。
	type?: TweetKind;
	is_deleted?: boolean;
	reply_count?: number;
	repost_count?: number;
	quote_count?: number;
	reaction_count?: number;
	/** #383: reaction kind 別集計 + viewer 別 my_kind. */
	reaction_summary?: ReactionAggregate;
	reply_to?: TweetMini | null;
	quote_of?: TweetMini | null;
	repost_of?: TweetMini | null;
	/**
	 * #351: viewer (request.user) 視点で「この tweet を自分が repost 済みか」。
	 * RepostButton.initialReposted に渡してリロード後の状態復元に使う。
	 * 未認証 / フィールド未付与時は undefined → false 扱い。
	 */
	reposted_by_me?: boolean;
	/**
	 * #499: viewer がこの tweet を保存している folder の id 配列。
	 * BookmarkButton.initialFolderIds に渡し、リロード後の塗り状態を復元する。
	 * backend が未付与の段階では undefined → 空配列扱い。
	 */
	bookmark_folder_ids?: number[];
	/**
	 * P13-01: 自動検出された言語コード (ISO 639-1)。
	 * 検出不可 / 短文の場合は null。 翻訳 button の表示判定に使う。
	 */
	language?: string | null;
}

export async function createTweet(
	payload: CreateTweetPayload,
	client: AxiosInstance = api,
): Promise<TweetSummary> {
	await ensureCsrfToken(client);
	const res = await client.post<TweetSummary>("/tweets/", payload);
	return res.data;
}

export interface TweetListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: TweetSummary[];
}

export interface TweetListParams {
	page?: number;
	author?: string;
	tag?: string;
}

export async function fetchTweetList(
	params: TweetListParams = {},
	client: AxiosInstance = api,
): Promise<TweetListPage> {
	const res = await client.get<TweetListPage>("/tweets/", { params });
	return res.data;
}

export async function fetchTweet(
	id: number | string,
	client: AxiosInstance = api,
): Promise<TweetSummary> {
	const res = await client.get<TweetSummary>(`/tweets/${id}/`);
	return res.data;
}

export async function updateTweet(
	id: number | string,
	payload: { body: string },
	client: AxiosInstance = api,
): Promise<TweetSummary> {
	await ensureCsrfToken(client);
	const res = await client.patch<TweetSummary>(`/tweets/${id}/`, payload);
	return res.data;
}

export async function deleteTweet(
	id: number | string,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete(`/tweets/${id}/`);
}

// ---- Phase 13 P13-03: 自動翻訳 ----

export interface TweetTranslationResponse {
	translated_text: string;
	source_language: string;
	target_language: string;
	/** true なら DB cache hit (OpenAI を呼んでいない). */
	cached: boolean;
}

/**
 * POST /api/v1/tweets/<id>/translate/
 *
 * 翻訳結果を取得する。 viewer の preferred_language に翻訳される。 同一言語 /
 * 言語検出不可は 422、 block 関係なら 403。
 */
export async function translateTweet(
	id: number | string,
	client: AxiosInstance = api,
): Promise<TweetTranslationResponse> {
	await ensureCsrfToken(client);
	const res = await client.post<TweetTranslationResponse>(
		`/tweets/${id}/translate/`,
	);
	return res.data;
}
