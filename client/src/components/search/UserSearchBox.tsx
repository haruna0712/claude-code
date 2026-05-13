"use client";

/**
 * UserSearchBox — /search/users 用の search input (Phase 12 P12-04)。
 *
 * 既存の SearchBox は tweet 用に演算子サジェスト UI を持っていて user 検索とは
 * UX が違うので別 component。 submit で /search/users?q=<value> に遷移。
 */

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

interface UserSearchBoxProps {
	initialValue?: string;
}

export default function UserSearchBox({
	initialValue = "",
}: UserSearchBoxProps) {
	const router = useRouter();
	const [value, setValue] = useState(initialValue);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = value.trim();
		if (!trimmed) {
			router.push("/search/users");
			return;
		}
		router.push(`/search/users?q=${encodeURIComponent(trimmed)}`);
	};

	return (
		<form
			role="search"
			aria-label="ユーザー検索"
			onSubmit={onSubmit}
			className="flex gap-2"
		>
			<input
				type="search"
				name="q"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="ユーザー名 / 表示名 / 自己紹介で検索"
				aria-label="ユーザー検索クエリ"
				// 異常に長いクエリで URL を肥大化させない防御 (typescript-reviewer
				// P12-04 MEDIUM)。 backend は VARCHAR 制約があるので 100 で十分。
				maxLength={100}
				className="flex-1 rounded-md border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<button
				type="submit"
				className="rounded-md bg-lime-500 px-4 py-2 text-sm font-semibold text-black hover:bg-lime-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				検索
			</button>
		</form>
	);
}
