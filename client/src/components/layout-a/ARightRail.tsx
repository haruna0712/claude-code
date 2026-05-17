"use client";

/**
 * A direction Right Rail (#550 Phase 10 POC, refactored #741).
 *
 * `/workspace/staticfiles/test/parts/home-a.jsx` RightRail の Next.js 移植。
 * 320px width、light theme、border-card panel + monospace meta。
 *
 * 既存 RightSidebar の中身 (TrendingTags / WhoToFollow) を A direction の
 * frame でラップ。
 *
 * #741 Twitter 準拠 IA refactor:
 *   - search panel を削除 (search box は /explore 最上部に統合済)
 *   - 抑制リスト拡張: /search, /agent, /messages/<id>, /articles/<slug>
 *     focused-task / private read-write / 長文 read surface を rail から守る
 *   - dummy footer text 削除 (about/pricing/changelog… の destination 未実装)
 *
 * 抑制判定は `lib/layout/focused-surfaces.ts` の `isFocusedSurface` に集約。
 */

import type { ReactNode } from "react";

import { usePathname } from "next/navigation";

import TrendingTags from "@/components/sidebar/TrendingTags";
import WhoToFollow from "@/components/sidebar/WhoToFollow";
import { useAuthNavigation } from "@/hooks";
import { shouldHideRightRail } from "@/lib/layout/focused-surfaces";

function APanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="mb-3 rounded-lg border border-[color:var(--a-border)] bg-[color:var(--a-bg)] px-3 py-2.5">
			<div
				className="mb-1.5 uppercase text-[color:var(--a-text-subtle)]"
				style={{
					fontFamily: "var(--a-font-mono)",
					fontSize: 10.5,
					letterSpacing: 0.4,
				}}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

export default function ARightRail() {
	const pathname = usePathname();
	const { isAuthenticated } = useAuthNavigation();

	if (shouldHideRightRail(pathname)) return null;

	return (
		<aside
			aria-label="右サイドバー"
			className="hidden h-screen overflow-y-auto px-4 py-3 lg:block"
			style={{
				width: 320,
				background: "var(--a-bg-subtle)",
				fontFamily: "var(--a-font-sans)",
			}}
		>
			<APanel title="Trending tags · 24h">
				<TrendingTags bare />
			</APanel>

			<APanel title="Who to follow">
				<WhoToFollow isAuthenticated={isAuthenticated} bare />
			</APanel>
		</aside>
	);
}
