import Link from "next/link";

type SearchMode = "tweets" | "users";

interface SearchModeTabsProps {
	mode: SearchMode;
	query?: string;
}

function hrefFor(mode: SearchMode, query: string): string {
	const params = new URLSearchParams();
	if (query) params.set("q", query);
	const qs = params.toString();
	const path = mode === "tweets" ? "/search" : "/search/users";
	return qs ? `${path}?${qs}` : path;
}

export default function SearchModeTabs({
	mode,
	query = "",
}: SearchModeTabsProps) {
	const trimmed = query.trim();
	const tabs: Array<{ mode: SearchMode; label: string }> = [
		{ mode: "tweets", label: "投稿" },
		{ mode: "users", label: "ユーザー" },
	];

	return (
		<nav
			aria-label="検索対象"
			className="mb-4 grid grid-cols-2 rounded-md border border-[color:var(--a-border)] p-1"
			style={{ background: "var(--a-bg-muted)" }}
		>
			{tabs.map((tab) => {
				const active = tab.mode === mode;
				return (
					<Link
						key={tab.mode}
						href={hrefFor(tab.mode, trimmed)}
						aria-current={active ? "page" : undefined}
						className="rounded px-3 py-1.5 text-center text-sm font-medium transition"
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
