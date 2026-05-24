"use client";

/**
 * UserSearchBox — /search/users 用の search input (Phase 12 P12-04)。
 *
 * 既存の SearchBox は tweet 用に演算子サジェスト UI を持っていて user 検索とは
 * UX が違うので別 component。 submit で /search/users?q=<value> に遷移。
 */

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { buildUserSearchHref, type SearchView } from "@/lib/api/userSearch";

interface UserSearchBoxProps {
	initialValue?: string;
	/** P12-08: 現在の表示モード。 検索 submit で list/map を維持する
	 *  (地図 view で検索すると list に戻る regression を防ぐ)。 */
	view?: SearchView;
}

export default function UserSearchBox({
	initialValue = "",
	view,
}: UserSearchBoxProps) {
	const router = useRouter();
	const [value, setValue] = useState(initialValue);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = value.trim();
		// view を維持して navigate。 occupation / near_me の維持は別 issue (#827)。
		router.push(buildUserSearchHref({ q: trimmed, view }));
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
				className="rounded-md px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				style={{ background: "var(--a-accent)" }}
			>
				検索
			</button>
		</form>
	);
}
