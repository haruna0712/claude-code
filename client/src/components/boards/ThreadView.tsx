"use client";

/**
 * ThreadView (Phase 5 / Issue #433 / #434).
 *
 * /threads/<id> のクライアント側コンポーネント。
 * - 990 警告バナー (`role="status"`)
 * - 1000 lock CTA (`role="alert"`)
 * - PostComposer (未ログイン CTA / locked CTA)
 * - レス削除後はローカル state で is_deleted=true に置換
 */

import Link from "next/link";
import { useCallback, useState } from "react";

import PostComposer from "@/components/boards/PostComposer";
import ThreadPostItem from "@/components/boards/ThreadPostItem";
import type { ThreadDetail, ThreadPost, ThreadState } from "@/lib/api/boards";
import type { PaginatedResponse } from "@/types";

interface ThreadViewProps {
	thread: ThreadDetail;
	initialPosts: PaginatedResponse<ThreadPost>;
	page: number;
	isAuthenticated: boolean;
	currentUserHandle: string | null;
	isAdmin: boolean;
}

export default function ThreadView({
	thread,
	initialPosts,
	page,
	isAuthenticated,
	currentUserHandle,
	isAdmin,
}: ThreadViewProps) {
	const [posts, setPosts] = useState<ThreadPost[]>(initialPosts.results);
	const [threadState, setThreadState] = useState<ThreadState>(
		thread.thread_state,
	);

	const handlePosted = useCallback((newState: ThreadState) => {
		setThreadState(newState);
		// 投稿成功時はサーバ反映を確認するため reload (低頻度なので acceptable)。
		window.location.reload();
	}, []);

	const handleDeleted = useCallback((postId: number) => {
		setPosts((cur) =>
			cur.map((p) =>
				p.id === postId
					? { ...p, is_deleted: true, body: "", images: [], author: null }
					: p,
			),
		);
	}, []);

	return (
		<main className="mx-auto w-full max-w-3xl px-4 py-6">
			<header className="mb-4">
				<p className="text-xs text-gray-500 dark:text-gray-400">
					<Link href={`/boards/${thread.board}`} className="hover:underline">
						← {thread.board} 板
					</Link>
				</p>
				<h1 className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
					{thread.title}
					{thread.locked && (
						<span
							className="ml-2 rounded bg-gray-200 px-2 py-0.5 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-300"
							aria-label="ロック済"
						>
							🔒 ロック済
						</span>
					)}
				</h1>
				<p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
					{threadState.post_count} / 1000 レス
				</p>
			</header>

			{threadState.locked && (
				<div
					role="alert"
					className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
				>
					このスレはレス上限 (1000)
					に達しました。新しいスレッドを立ててください。
				</div>
			)}
			{!threadState.locked && threadState.approaching_limit && (
				<div
					role="status"
					className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
				>
					残りわずかです (現在 {threadState.post_count}{" "}
					レス)。新スレッドの作成を検討してください。
				</div>
			)}

			<section aria-labelledby="post-list-heading">
				<h2 id="post-list-heading" className="sr-only">
					レス一覧
				</h2>
				{posts.length === 0 ? (
					<p className="text-sm text-gray-500 dark:text-gray-400">
						まだレスがありません。
					</p>
				) : (
					<ol
						role="list"
						className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
					>
						{posts.map((p) => (
							<ThreadPostItem
								key={p.id}
								post={p}
								currentUserHandle={currentUserHandle}
								isAdmin={isAdmin}
								onDelete={handleDeleted}
							/>
						))}
					</ol>
				)}

				<nav
					aria-label="ページネーション"
					className="mt-4 flex items-center justify-between text-sm"
				>
					{initialPosts.previous ? (
						<a
							href={`/threads/${thread.id}?p=${page - 1}`}
							className="text-blue-600 hover:underline dark:text-blue-400"
						>
							← 前のページ
						</a>
					) : (
						<span />
					)}
					<span className="text-gray-500 dark:text-gray-400">
						全 {initialPosts.count} レス
					</span>
					{initialPosts.next ? (
						<a
							href={`/threads/${thread.id}?p=${page + 1}`}
							className="text-blue-600 hover:underline dark:text-blue-400"
						>
							次のページ →
						</a>
					) : (
						<span />
					)}
				</nav>
			</section>

			<section className="mt-6">
				<PostComposer
					threadId={thread.id}
					isAuthenticated={isAuthenticated}
					threadState={threadState}
					boardSlug={thread.board}
					onPosted={handlePosted}
				/>
			</section>
		</main>
	);
}
