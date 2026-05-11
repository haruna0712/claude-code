"use client";

/**
 * TrendingTags — right-rail panel listing the top trending tags.
 *
 * MVP scope (P2-17 / Issue #189):
 *   - One-shot fetch on mount; polling/refresh deferred to a follow-up.
 *   - Skeleton → data | empty | error fallback.
 *   - Up to 10 items, each linking to /tag/<name>.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchTrendingTags, type TrendingTag } from "@/lib/api/trending";

const SKELETON_ROWS = 5;
const MAX_ITEMS = 10;

type LoadState = "loading" | "ready" | "error";

interface TrendingTagsProps {
	/**
	 * #557: ARightRail (A direction) で APanel に内包する場合に外側 section の
	 * card style (border + bg + p-4) を抑制する。デフォルトは旧 RightSidebar 互換。
	 */
	bare?: boolean;
}

export default function TrendingTags({ bare = false }: TrendingTagsProps) {
	const [tags, setTags] = useState<TrendingTag[]>([]);
	const [state, setState] = useState<LoadState>("loading");

	useEffect(() => {
		let cancelled = false;
		fetchTrendingTags()
			.then((data) => {
				if (cancelled) return;
				setTags(data.slice(0, MAX_ITEMS));
				setState("ready");
			})
			.catch(() => {
				if (cancelled) return;
				setState("error");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<section
			aria-label={bare ? "トレンドタグ" : undefined}
			aria-labelledby={bare ? undefined : "sidebar-trending-heading"}
			className={bare ? "" : "rounded-lg border border-border bg-card p-4"}
		>
			{!bare && (
				<h2
					id="sidebar-trending-heading"
					className="mb-3 text-sm font-semibold text-foreground"
				>
					トレンドタグ
				</h2>
			)}

			{state === "loading" && (
				<ul className="space-y-2">
					{Array.from({ length: SKELETON_ROWS }).map((_, i) => (
						<li
							key={i}
							role="listitem"
							aria-busy="true"
							className="h-6 w-full animate-pulse rounded bg-muted"
						/>
					))}
				</ul>
			)}

			{state === "error" && (
				<p className="text-sm text-muted-foreground">
					トレンドの取得に失敗しました
				</p>
			)}

			{state === "ready" && tags.length === 0 && (
				<p className="text-sm text-muted-foreground">
					トレンドはまだ集計中です
				</p>
			)}

			{state === "ready" && tags.length > 0 && (
				<ul className="flex flex-col gap-1">
					{tags.map((tag) => (
						<li key={tag.name}>
							<Link
								href={`/tag/${tag.name}`}
								className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="flex items-center gap-2">
									<span className="w-6 text-xs font-bold text-lime-600 dark:text-lime-400">
										#{tag.rank}
									</span>
									{tag.emoji && <span aria-hidden="true">{tag.emoji}</span>}
									<span className="text-sm text-foreground">
										{tag.display_name}
									</span>
								</span>
								<span className="text-xs text-muted-foreground">
									{tag.uses}
								</span>
							</Link>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
