import Link from "next/link";

import type { UserSearchResultItem } from "@/lib/api/userSearch";

interface UserSearchResultCardProps {
	user: UserSearchResultItem;
}

/**
 * バックエンドから来た avatar_url が http(s) スキームに限定されていることを確認する。
 * `javascript:` / `data:` のような scheme 注入を防ぐ防御 (typescript-reviewer
 * P12-04 HIGH 対応)。 backend validate_media_url で同じ enforcement をしているが、
 * 表示直前にも二重防御する。 失敗時は null を返して `<img>` を出さない。
 */
function safeAvatarUrl(url: string): string | null {
	if (!url) return null;
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return null;
		}
		return url;
	} catch {
		return null;
	}
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
	const safeAvatar = safeAvatarUrl(user.avatar_url);
	return (
		<li>
			<Link
				href={`/u/${handle}`}
				className="flex items-start gap-3 rounded-lg border border-border p-3 transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				{safeAvatar ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img
						src={safeAvatar}
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
