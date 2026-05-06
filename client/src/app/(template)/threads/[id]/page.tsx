/**
 * /threads/<id> スレ詳細ページ (Phase 5 / Issue #433).
 *
 * SSR でスレメタと posts (1 ページ目) を取得。匿名閲覧可。
 * インタラクション (PostComposer / 削除) はクライアントサイドで担う。
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";

import ThreadView from "@/components/boards/ThreadView";
import type { ThreadDetail, ThreadPost } from "@/lib/api/boards";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { PaginatedResponse } from "@/types";

interface PageProps {
	params: { id: string };
	searchParams?: { p?: string };
}

interface CurrentUser {
	id: string;
	username: string;
	is_staff?: boolean;
}

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	try {
		const thread = await serverFetch<ThreadDetail>(`/threads/${params.id}/`);
		return {
			title: `${thread.title} — 掲示板`,
			description: `スレッド: ${thread.title} (${thread.post_count} レス)`,
		};
	} catch {
		return { title: "スレッド" };
	}
}

async function fetchData(
	id: string,
	page: number,
): Promise<{
	thread: ThreadDetail;
	posts: PaginatedResponse<ThreadPost>;
	currentUser: CurrentUser | null;
} | null> {
	let thread: ThreadDetail;
	try {
		thread = await serverFetch<ThreadDetail>(`/threads/${id}/`);
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 404) return null;
		return null;
	}
	const posts = await serverFetch<PaginatedResponse<ThreadPost>>(
		`/threads/${id}/posts/?page=${page}`,
	).catch(() => ({
		count: 0,
		next: null,
		previous: null,
		results: [] as ThreadPost[],
	}));
	let currentUser: CurrentUser | null = null;
	try {
		currentUser = await serverFetch<CurrentUser>("/users/me/");
	} catch {
		currentUser = null;
	}
	return { thread, posts, currentUser };
}

export default async function ThreadDetailPage({
	params,
	searchParams,
}: PageProps) {
	const page = Math.max(1, Number(searchParams?.p ?? 1));
	const id = Number(params.id);
	if (!Number.isFinite(id) || id <= 0) notFound();

	const data = await fetchData(params.id, page);
	if (!data) notFound();
	const { thread, posts, currentUser } = data;
	const isAuthenticated =
		cookies().get("logged_in")?.value === "true" && Boolean(currentUser);

	return (
		<ThreadView
			thread={thread}
			initialPosts={posts}
			page={page}
			isAuthenticated={isAuthenticated}
			currentUserHandle={currentUser?.username ?? null}
			isAdmin={Boolean(currentUser?.is_staff)}
		/>
	);
}
