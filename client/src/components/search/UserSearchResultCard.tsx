import Link from "next/link";

import type { UserSearchResultItem } from "@/lib/api/userSearch";

interface UserSearchResultCardProps {
	user: UserSearchResultItem;
}

/**
 * Single user card row for the /search/users page (Phase 12 P12-04).
 * Avatar + display_name + @handle + bio (3 line clamp)。
 */
export default function UserSearchResultCard({
	user,
}: UserSearchResultCardProps) {
	const handle = user.username;
	const name = user.display_name || user.username;
	return (
		<li>
			<Link
				href={`/u/${handle}`}
				className="flex items-start gap-3 rounded-lg border border-border p-3 transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{user.avatar_url ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={user.avatar_url}
						alt=""
						className="size-12 shrink-0 rounded-full bg-muted object-cover"
					/>
				) : (
					<div className="size-12 shrink-0 rounded-full bg-muted" aria-hidden />
				)}
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2">
						<span className="truncate text-sm font-semibold">{name}</span>
						<span
							className="truncate text-xs text-muted-foreground"
							style={{ fontFamily: "var(--a-font-mono)" }}
						>
							@{handle}
						</span>
					</div>
					{user.bio && (
						<p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
							{user.bio}
						</p>
					)}
				</div>
			</Link>
		</li>
	);
}
