"use client";

/**
 * UserList — フォロー中 / フォロワー 一覧の共通 UI (#421).
 *
 * `/u/<handle>/following` / `/u/<handle>/followers` で使う。
 * cursor pagination、各 row に avatar + display_name + handle + bio + FollowButton。
 */

import { useEffect, useState } from "react";

import FollowButton from "@/components/follows/FollowButton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/lib/api/client";
import { CircleUser } from "lucide-react";
import Link from "next/link";

export interface FollowListUser {
	id: string;
	username: string;
	display_name: string;
	avatar_url: string;
	bio: string;
	is_following?: boolean;
}

interface FollowListResponse {
	results: FollowListUser[];
	next: string | null;
	previous: string | null;
}

interface UserListProps {
	endpoint: string; // 例: /users/test2/followers/
	emptyMessage: string;
}

type LoadState = "loading" | "ready" | "error";

export default function UserList({ endpoint, emptyMessage }: UserListProps) {
	const [users, setUsers] = useState<FollowListUser[]>([]);
	const [next, setNext] = useState<string | null>(null);
	const [state, setState] = useState<LoadState>("loading");

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		api
			.get<FollowListResponse>(endpoint)
			.then((res) => {
				if (cancelled) return;
				const data = res.data;
				setUsers(data.results ?? []);
				setNext(data.next ?? null);
				setState("ready");
			})
			.catch(() => {
				if (cancelled) return;
				setState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [endpoint]);

	const loadMore = async () => {
		if (!next) return;
		try {
			const res = await api.get<FollowListResponse>(next);
			setUsers((prev) => [...prev, ...(res.data.results ?? [])]);
			setNext(res.data.next ?? null);
		} catch {
			// silent
		}
	};

	if (state === "loading") {
		return (
			<div
				role="status"
				aria-live="polite"
				className="p-8 text-center text-muted-foreground"
			>
				読み込み中…
			</div>
		);
	}
	if (state === "error") {
		return (
			<div role="alert" className="text-baby_red p-8 text-center">
				取得に失敗しました
			</div>
		);
	}
	if (users.length === 0) {
		return (
			<div className="p-8 text-center text-muted-foreground">
				{emptyMessage}
			</div>
		);
	}

	return (
		<>
			<ul className="divide-y divide-border">
				{users.map((u) => {
					const visibleName = u.display_name || u.username;
					return (
						<li key={u.username} className="flex items-start gap-3 p-4">
							<Link
								href={`/u/${u.username}`}
								aria-label={`${visibleName} (@${u.username}) のプロフィール`}
								className="shrink-0"
							>
								<Avatar className="size-12">
									<AvatarImage src={u.avatar_url} alt="" />
									<AvatarFallback>
										<CircleUser className="size-6" aria-hidden="true" />
									</AvatarFallback>
								</Avatar>
							</Link>
							<div className="min-w-0 flex-1">
								<Link
									href={`/u/${u.username}`}
									className="block hover:underline"
								>
									<span className="block truncate text-sm font-semibold text-foreground">
										{visibleName}
									</span>
									<span className="block truncate text-xs text-muted-foreground">
										@{u.username}
									</span>
								</Link>
								{u.bio ? (
									<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
										{u.bio}
									</p>
								) : null}
							</div>
							<div className="shrink-0">
								<FollowButton
									targetHandle={u.username}
									initialIsFollowing={Boolean(u.is_following)}
									size="sm"
								/>
							</div>
						</li>
					);
				})}
			</ul>
			{next ? (
				<div className="border-t border-border p-4 text-center">
					<button
						type="button"
						onClick={loadMore}
						className="rounded-full border border-border px-6 py-2 text-sm text-muted-foreground hover:bg-muted"
					>
						もっと見る
					</button>
				</div>
			) : null}
		</>
	);
}
