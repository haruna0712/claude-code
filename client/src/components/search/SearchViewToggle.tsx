"use client";

/**
 * list ↔ map の表示切替 (Phase 12 P12-08b, #817)。
 *
 * URL-backed な segmented control。 2 つの ``<Link>`` で ``?view=list`` /
 * ``?view=map`` に navigate し、 現在の view に ``aria-current`` を立てる。
 * Link なので JS hydration 前でも動き、 navigation 後の focus も失わない
 * (#816 で踏んだ router.push 後 focus 落ちを回避)。 既存の q / occupation /
 * near_me filter は ``buildUserSearchHref`` で維持する。
 */

import Link from "next/link";

import {
	buildUserSearchHref,
	type SearchView,
	type UserSearchQueryState,
} from "@/lib/api/userSearch";

interface SearchViewToggleProps {
	/** 現在の view。 */
	view: SearchView;
	/** 維持すべき検索条件 (view 以外)。 */
	query: Omit<UserSearchQueryState, "view" | "cursor">;
}

const OPTIONS: { value: SearchView; label: string }[] = [
	{ value: "list", label: "一覧" },
	{ value: "map", label: "地図" },
];

export default function SearchViewToggle({
	view,
	query,
}: SearchViewToggleProps) {
	return (
		<div
			role="group"
			aria-label="検索結果の表示切替"
			className="inline-flex overflow-hidden rounded-md border"
			style={{ borderColor: "var(--a-border)" }}
		>
			{OPTIONS.map((opt) => {
				const active = opt.value === view;
				return (
					<Link
						key={opt.value}
						href={buildUserSearchHref({ ...query, view: opt.value })}
						aria-current={active ? "page" : undefined}
						className={
							"px-3 py-1.5 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent-deep)] " +
							(active
								? "bg-[color:var(--a-accent-deep)] font-semibold text-white"
								: "bg-background text-foreground hover:bg-muted")
						}
					>
						{opt.label}
					</Link>
				);
			})}
		</div>
	);
}
