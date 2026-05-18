/**
 * MentorsModeTabs — `/mentors` page の tab 切替 (#759).
 *
 * Spec: docs/specs/mentor-merge-spec.md §1.4
 *
 * 旧 `/mentor/wanted` (相談 board) と `/mentors` (mentor directory) を
 * 1 route + 2 tab に統合した際の tab UI。 SSR-friendly Link-based pattern
 * (既存 `SearchModeTabs` の流儀)、 client state 不要。
 *
 * mode:
 *   - "requests": 相談 board (`?tab=requests` or no query = default)
 *   - "directory": mentor 一覧 (`?tab=directory`)
 */

import Link from "next/link";

export type MentorsTabMode = "requests" | "directory";

interface MentorsModeTabsProps {
	mode: MentorsTabMode;
	/** `?tag=<value>` filter を preserve するための tag (skill 等)。 */
	tag?: string;
}

function hrefFor(mode: MentorsTabMode, tag?: string): string {
	const params = new URLSearchParams();
	params.set("tab", mode);
	if (tag) params.set("tag", tag);
	return `/mentors?${params.toString()}`;
}

export default function MentorsModeTabs({ mode, tag }: MentorsModeTabsProps) {
	const tabs: Array<{ mode: MentorsTabMode; label: string }> = [
		{ mode: "requests", label: "募集中の相談" },
		{ mode: "directory", label: "メンター一覧" },
	];

	return (
		<nav
			aria-label="メンタータブ"
			className="mb-4 grid grid-cols-2 rounded-md border border-[color:var(--a-border)] p-1"
			style={{ background: "var(--a-bg-muted)" }}
		>
			{tabs.map((tab) => {
				const active = tab.mode === mode;
				return (
					<Link
						key={tab.mode}
						href={hrefFor(tab.mode, tag)}
						aria-current={active ? "page" : undefined}
						className="rounded px-3 py-1.5 text-center text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
						style={{
							background: active ? "var(--a-bg)" : "transparent",
							color: active ? "var(--a-text)" : "var(--a-text-muted)",
							boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
						}}
					>
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
