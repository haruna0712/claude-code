/**
 * (a) route group layout — Phase 10 Claude Design A direction (#550 POC).
 *
 * Linear / Vercel ベース light theme、3 カラム grid:
 *   232px (ALeftNav) | 1fr (center) | 320px (ARightRail, lg+)
 *
 * mobile (< sm): ALeftNav 非表示 (TODO: AMobileNav は Phase B で別途)
 * tablet (< lg): ARightRail 非表示
 *
 * `(template)` layout とは独立。POC では `/` (home) のみ本 layout を使う。
 */

import type { ReactNode } from "react";

import ALeftNav from "@/components/layout-a/ALeftNav";
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
				className="flex flex-col overflow-hidden border-r border-[color:var(--a-border)]"
				aria-label="メインコンテンツ"
			>
				{children}
			</main>
			<ARightRail />
		</div>
	);
}
