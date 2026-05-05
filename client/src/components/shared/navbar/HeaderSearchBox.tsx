"use client";

/**
 * HeaderSearchBox — global Navbar 内の検索 input (#377).
 *
 * 仕様: docs/specs/search-spec.md §4.2
 *
 * - Navbar 内に常時表示。submit で /search?q=<encoded> に router.push。
 * - 演算子ヘルプは /search ページの SearchBox に任せる (Navbar は footprint
 *   優先で input + button 1 行のみ)。
 * - URL の q 初期値は受け取らない (= 直接 /search を開いて編集する用途は
 *   既存 SearchBox の責務)。Navbar の値はページ遷移ごとにリセットされる。
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export default function HeaderSearchBox() {
	const router = useRouter();
	const [value, setValue] = useState("");

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
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
			className="flex min-w-0 max-w-md flex-1 items-center gap-2"
		>
			<input
				type="search"
				name="q"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="検索"
				aria-label="検索クエリ"
				className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<button
				type="submit"
				className="hidden shrink-0 rounded-md bg-lime-500 px-3 py-1.5 text-sm font-semibold text-black hover:bg-lime-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
			>
				検索
			</button>
		</form>
	);
}
