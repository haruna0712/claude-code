"use client";

/**
 * WhoToFollow — right-rail recommendation panel.
 *
 * MVP scope (P2-17 / Issue #189):
 *   - Auth state determines endpoint: /users/recommended/ vs /users/popular/.
 *   - Reason chip (e.g. "同じタグを投稿") only shown for personalised
 *     authenticated results.
 *   - Follow button is rendered as an aria-disabled placeholder; the actual
 *     follow action is wired up in P2-15 once the follow API is integrated.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import FollowButton from "@/components/follows/FollowButton";
import {
	fetchPopularUsers,
	fetchRecommendedUsers,
	localizeReason,
	type SidebarUser,
} from "@/lib/api/trending";

const SKELETON_ROWS = 3;
const LIMIT = 5;

type LoadState = "loading" | "ready" | "error";

interface WhoToFollowProps {
	isAuthenticated: boolean;
}

export default function WhoToFollow({ isAuthenticated }: WhoToFollowProps) {
	const [users, setUsers] = useState<SidebarUser[]>([]);
	const [state, setState] = useState<LoadState>("loading");

	useEffect(() => {
		let cancelled = false;
		const fetcher = isAuthenticated
			? () => fetchRecommendedUsers(LIMIT)
			: () => fetchPopularUsers(LIMIT);
		fetcher()
			.then((data) => {
				if (cancelled) return;
				setUsers(data);
				setState("ready");
			})
			.catch(() => {
				if (cancelled) return;
				setState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [isAuthenticated]);

	return (
		<section
			aria-labelledby="sidebar-wtf-heading"
			className="rounded-lg border border-border bg-card p-4"
		>
			<h2
				id="sidebar-wtf-heading"
				className="mb-3 text-sm font-semibold text-foreground"
			>
				おすすめユーザー
			</h2>

			{state === "loading" && (
				<ul className="space-y-3">
					{Array.from({ length: SKELETON_ROWS }).map((_, i) => (
						<li
							key={i}
							role="listitem"
							aria-busy="true"
							className="flex items-center gap-3"
						>
							<div className="size-10 shrink-0 animate-pulse rounded-full bg-muted" />
							<div className="flex-1 space-y-1.5">
								<div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
								<div className="h-2 w-1/3 animate-pulse rounded bg-muted" />
							</div>
						</li>
					))}
				</ul>
			)}

			{state === "error" && (
				<p className="text-sm text-muted-foreground">
					おすすめの取得に失敗しました
				</p>
			)}

			{state === "ready" && users.length === 0 && (
				<p className="text-sm text-muted-foreground">
					おすすめユーザーがいません
				</p>
			)}

			{state === "ready" && users.length > 0 && (
				<ul className="flex flex-col gap-3">
					{users.map((user) => (
						<li key={user.handle} className="flex items-center gap-3">
							{user.avatar_url ? (
								<img
									src={user.avatar_url}
									alt=""
									aria-hidden="true"
									className="size-10 shrink-0 rounded-full object-cover"
								/>
							) : (
								<div
									aria-hidden="true"
									className="size-10 shrink-0 rounded-full bg-muted"
								/>
							)}
							<div className="min-w-0 flex-1">
								<Link
									href={`/u/${user.handle}`}
									className="block truncate text-sm font-semibold text-foreground hover:underline"
								>
									{user.display_name}
								</Link>
								<span className="block truncate text-xs text-muted-foreground">
									@{user.handle}
								</span>
								{isAuthenticated && localizeReason(user.reason) && (
									<span className="mt-1 inline-block rounded-full bg-lime-500/10 px-2 py-0.5 text-xs text-lime-700 dark:text-lime-400">
										{localizeReason(user.reason)}
									</span>
								)}
							</div>
							{/* #296: 旧 placeholder (aria-disabled=true) を本配線に置換。
							    認証済の時のみ button を表示 (未ログインで follow API 401 を
							    起こさない)。recommended / popular は基本フォロー外なので
							    initialIsFollowing=false 既定で十分。 */}
							{isAuthenticated ? (
								<FollowButton
									targetHandle={user.handle}
									initialIsFollowing={Boolean(user.is_following)}
									size="sm"
								/>
							) : null}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
