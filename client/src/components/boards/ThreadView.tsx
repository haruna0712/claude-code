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
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href={`/boards/${thread.board}`}
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← {thread.board}
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						{thread.title}
						{thread.locked && (
							<span
								className="ml-2 inline-block rounded bg-[color:var(--a-bg-muted)] px-2 py-0.5 text-xs text-[color:var(--a-text-muted)]"
								aria-label="ロック済"
							>
								🔒
							</span>
						)}
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{threadState.post_count} / 1000 レス
					</p>
				</div>
			</header>

			<div className="p-5">
				{threadState.locked && (
					<div
						role="alert"
						className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
					>
						このスレはレス上限 (1000)
						に達しました。新しいスレッドを立ててください。
					</div>
				)}
				{!threadState.locked && threadState.approaching_limit && (
					<div
						role="status"
						className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
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
						<p className="text-sm text-[color:var(--a-text-muted)]">
							まだレスがありません。
						</p>
					) : (
						<ol
							role="list"
							className="rounded-lg border border-[color:var(--a-border)] bg-[color:var(--a-bg)]"
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
								className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								style={{ color: "var(--a-accent)" }}
							>
								← 前のページ
							</a>
						) : (
							<span />
						)}
						<span className="text-[color:var(--a-text-muted)]">
							全 {initialPosts.count} レス
						</span>
						{initialPosts.next ? (
							<a
								href={`/threads/${thread.id}?p=${page + 1}`}
								className="rounded hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
								style={{ color: "var(--a-accent)" }}
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
			</div>
		</>
	);
}
