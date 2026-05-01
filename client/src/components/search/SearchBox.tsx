"use client";

/**
 * SearchBox — header search form on the /search page.
 *
 * MVP scope (P2-16 / Issue #207):
 *   - Controlled <input>, submit navigates to /search?q=<value>.
 *   - Operator help is shown statically below the box; popup-style
 *     autosuggest ships as a follow-up.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

interface SearchBoxProps {
	initialValue?: string;
}

const OPERATOR_HELP: ReadonlyArray<{ key: string; example: string }> = [
	{ key: "tag:", example: "tag:django" },
	{ key: "from:", example: "from:@alice" },
	{ key: "since:", example: "since:2026-01-01" },
	{ key: "until:", example: "until:2026-12-31" },
	{ key: "type:", example: "type:reply" },
	{ key: "has:", example: "has:image" },
];

export default function SearchBox({ initialValue = "" }: SearchBoxProps) {
	const router = useRouter();
	const [value, setValue] = useState(initialValue);

	const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = value.trim();
		if (!trimmed) return;
		router.push(`/search?q=${encodeURIComponent(trimmed)}`);
	};

	return (
		<form
			role="search"
			aria-label="ツイート検索"
			onSubmit={onSubmit}
			className="flex flex-col gap-2"
		>
			<div className="flex gap-2">
				<input
					type="search"
					name="q"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="例: python tag:django from:alice"
					aria-label="検索クエリ"
					className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				/>
				<button
					type="submit"
					className="rounded-md bg-lime-500 px-4 py-2 text-sm font-semibold text-black hover:bg-lime-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					検索
				</button>
			</div>
			<details className="text-xs text-muted-foreground">
				<summary className="cursor-pointer select-none">
					フィルタ演算子の使い方
				</summary>
				<ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-3">
					{OPERATOR_HELP.map((op) => (
						<li key={op.key} className="font-mono">
							<code className="text-foreground">{op.key}</code>{" "}
							<span className="text-muted-foreground">{op.example}</span>
						</li>
					))}
				</ul>
			</details>
		</form>
	);
}
