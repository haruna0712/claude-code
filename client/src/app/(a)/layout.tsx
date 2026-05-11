/**
 * (a) route group layout — Phase 10 Claude Design A direction.
 *
 * Linear / Vercel ベース light theme、3 カラム grid:
 *   232px (ALeftNav) | 1fr (center) | 320px (ARightRail, lg+)
 *
 * mobile (< sm): ALeftNav 非表示 → AMobileAppBar (上部 app bar + 下部 tab bar
 *                + drawer) で nav 代替 (#552 Phase B-0-1)
 * tablet (< lg): ARightRail 非表示
 */

import type { ReactNode } from "react";

import ALeftNav from "@/components/layout-a/ALeftNav";
import AMobileAppBar from "@/components/layout-a/AMobileShell";
import ARightRail from "@/components/layout-a/ARightRail";

interface AppLayoutProps {
	children: ReactNode;
}

export default function ALayout({ children }: AppLayoutProps) {
	return (
		<div
			className="grid min-h-screen"
			style={{
				background: "var(--a-bg)",
				color: "var(--a-text)",
				fontFamily: "var(--a-font-sans)",
				gridTemplateColumns: "auto 1fr auto",
			}}
		>
			<ALeftNav />
			<main
				className="flex min-w-0 flex-col overflow-hidden sm:border-r sm:border-[color:var(--a-border)]"
				aria-label="メインコンテンツ"
			>
				<AMobileAppBar />
				{children}
			</main>
			<ARightRail />
		</div>
	);
}
