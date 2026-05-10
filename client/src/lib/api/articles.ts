/**
 * Articles API helpers (#534-536 / Phase 6 P6-11/12/13).
 *
 * Backend: `/api/v1/articles/` (apps/articles/views.py)。
 * - GET    /                     公開記事一覧 (匿名 OK、cursor pagination)
 * - POST   /                     新規作成 (auth)
 * - GET    /<slug>/              詳細 (匿名 OK、draft は本人のみ)
 * - PATCH  /<slug>/              編集 (本人のみ)
 * - DELETE /<slug>/              論理削除 (本人 + admin)
 * - GET    /me/drafts/           自分の下書き一覧 (auth)
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";

export type ArticleStatus = "draft" | "published";

export interface ArticleAuthor {
	handle: string;
	display_name: string;
	avatar_url: string;
}

export interface ArticleTag {
	slug: string;
	display_name: string;
}

export interface ArticleSummary {
	id: string;
	slug: string;
	title: string;
	status: ArticleStatus;
	published_at: string | null;
	view_count: number;
	author: ArticleAuthor;
	tags: ArticleTag[];
	like_count: number;
	comment_count: number;
	created_at: string;
	updated_at: string;
}

export interface ArticleDetail extends ArticleSummary {
	body_markdown: string;
	body_html: string;
}

interface ArticleListResponse {
	results: ArticleSummary[];
	next: string | null;
	previous: string | null;
}

export interface CreateArticleInput {
	title: string;
	body_markdown: string;
	slug?: string;
	status?: ArticleStatus;
	tags?: string[]; // tag slugs
}

export interface UpdateArticleInput {
	title?: string;
	body_markdown?: string;
	slug?: string;
	status?: ArticleStatus;
	tags?: string[];
}

export async function listArticles(
	params: { author?: string; tag?: string; cursor?: string } = {},
	client: AxiosInstance = api,
): Promise<ArticleListResponse> {
	const res = await client.get<ArticleListResponse>("/articles/", { params });
	return res.data;
}

export async function fetchArticle(
	slug: string,
	client: AxiosInstance = api,
): Promise<ArticleDetail> {
	const res = await client.get<ArticleDetail>(`/articles/${slug}/`);
	return res.data;
}

export async function createArticle(
	input: CreateArticleInput,
	client: AxiosInstance = api,
): Promise<ArticleDetail> {
	await ensureCsrfToken(client);
	const res = await client.post<ArticleDetail>("/articles/", input);
	return res.data;
}

export async function updateArticle(
	slug: string,
	input: UpdateArticleInput,
	client: AxiosInstance = api,
): Promise<ArticleDetail> {
	await ensureCsrfToken(client);
	const res = await client.patch<ArticleDetail>(`/articles/${slug}/`, input);
	return res.data;
}

export async function deleteArticle(
	slug: string,
	client: AxiosInstance = api,
): Promise<void> {
	await ensureCsrfToken(client);
	await client.delete(`/articles/${slug}/`);
}

export async function listMyDrafts(
	cursor: string | undefined = undefined,
	client: AxiosInstance = api,
): Promise<ArticleListResponse> {
	const res = await client.get<ArticleListResponse>("/articles/me/drafts/", {
		params: cursor ? { cursor } : undefined,
	});
	return res.data;
}
