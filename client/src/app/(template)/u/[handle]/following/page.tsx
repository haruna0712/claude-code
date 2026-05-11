/**
 * /u/<handle>/following — handle がフォロー中のユーザ一覧 (#421, X 風).
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import UserList from "@/components/follows/UserList";
import { ApiServerError, serverFetch } from "@/lib/api/server";

interface PageProps {
	params: { handle: string };
}

interface MinimalProfile {
	username: string;
	display_name: string;
}

async function loadProfile(handle: string): Promise<MinimalProfile | null> {
	try {
		return await serverFetch<MinimalProfile>(`/users/${handle}/`);
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 404) return null;
		throw error;
	}
}

export default async function FollowingPage({ params }: PageProps) {
	const profile = await loadProfile(params.handle);
	if (!profile) notFound();

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
					href={`/u/${profile.username}`}
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← @{profile.username}
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						フォロー中
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{profile.display_name || profile.username}
					</p>
				</div>
			</header>
			<div className="pb-10">
				<UserList
					endpoint={`/users/${profile.username}/following/`}
					emptyMessage="まだ誰もフォローしていません。"
				/>
			</div>
		</>
	);
}
