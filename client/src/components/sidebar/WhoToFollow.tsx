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
// #399: 基本表示数を 3 に。backend 側で relaxed fallback (既フォロー込み) が
// 走るため、未フォロー候補が少なくても 3 人埋めようと試みる。
const LIMIT = 3;

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
					{users.map((user) => {
						// #392: display_name 空のときは @handle を太字 fallback に
						const visibleName = user.display_name || user.handle;
						const profileLabel = `${visibleName} (@${user.handle}) のプロフィール`;
						return (
							<li key={user.handle} className="flex items-start gap-3">
								{/* #392: avatar を Link 化 (X 慣習)。
								    profile-navigation-spec.md §3.2 参照。 */}
								<Link
									href={`/u/${user.handle}`}
									aria-label={profileLabel}
									className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{user.avatar_url ? (
										<img
											src={user.avatar_url}
											alt=""
											aria-hidden="true"
											className="size-10 rounded-full object-cover"
										/>
									) : (
										<div
											aria-hidden="true"
											className="size-10 rounded-full bg-muted"
										/>
									)}
								</Link>
								{/* #392: display_name + @handle + bio を 1 つの Link で
								    まとめて wrap (Tab 移動の冗長を回避)。FollowButton は
								    別 interactive で wrap の外に置く。 */}
								<Link
									href={`/u/${user.handle}`}
									aria-label={profileLabel}
									className="group min-w-0 flex-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="block truncate text-sm font-semibold text-foreground group-hover:underline">
										{visibleName}
									</span>
									<span className="block truncate text-xs text-muted-foreground group-hover:underline">
										@{user.handle}
									</span>
									{user.bio ? (
										<span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
											{user.bio}
										</span>
									) : null}
									{isAuthenticated && localizeReason(user.reason) ? (
										<span className="mt-1 inline-block rounded-full bg-lime-500/10 px-2 py-0.5 text-xs text-lime-700 dark:text-lime-400">
											{localizeReason(user.reason)}
										</span>
									) : null}
								</Link>
								{/* #296: 認証済の時のみ button を表示 (未ログインで follow
								    API 401 を起こさない)。Link の外に置いて独立 click 領域に。 */}
								{isAuthenticated ? (
									<FollowButton
										targetHandle={user.handle}
										initialIsFollowing={Boolean(user.is_following)}
										size="sm"
									/>
								) : null}
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}
