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
		<main className="mx-auto max-w-3xl pb-10">
			<header className="border-b border-border px-4 py-3">
				<Link
					href={`/u/${profile.username}`}
					className="text-xs text-muted-foreground hover:underline"
				>
					← {profile.display_name || profile.username} さんのプロフィールへ戻る
				</Link>
				<h1 className="mt-1 text-lg font-bold">
					{profile.display_name || profile.username} がフォロー中
				</h1>
				<p className="text-xs text-muted-foreground">@{profile.username}</p>
			</header>
			<UserList
				endpoint={`/users/${profile.username}/following/`}
				emptyMessage="まだ誰もフォローしていません。"
			/>
		</main>
	);
}
