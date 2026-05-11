/**
 * (template) route group layout — Phase B-1-0 (#564).
 *
 * 旧 LeftNavbar (dark) / MobileNavbar / RightSidebar から
 * **A direction shell** (ALeftNav + AMobileAppBar + ARightRail + 800px center grid)
 * に統一する。Phase B-0 で `/` だけだった A direction を全 (template) 配下 page に
 * 拡大する。
 *
 * 3 カラム grid:
 *   232px (ALeftNav) | 1fr → 800px max (center) | 320px (ARightRail, lg+)
 *
 * mobile (< sm): ALeftNav 非表示 → AMobileAppBar の bottom-tab + drawer
 * tablet (< lg): ARightRail 非表示
 *
 * 各 page 本文 (TweetCard 等) は本 PR では未調整。dark theme 残骸が出る場合は
 * 後続 issue (B-1-1〜) で個別に直す。
 */

import type { ReactNode } from "react";

import AComposeDialogHost from "@/components/layout-a/AComposeDialogHost";
import ALeftNav from "@/components/layout-a/ALeftNav";
import AMobileAppBar from "@/components/layout-a/AMobileShell";
import ARightRail from "@/components/layout-a/ARightRail";

interface LayoutProps {
	children: ReactNode;
}

export default function TemplateLayout({ children }: LayoutProps) {
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
				className="mx-auto flex w-full min-w-0 flex-col sm:border-r sm:border-[color:var(--a-border)]"
				style={{ maxWidth: 800 }}
				aria-label="メインコンテンツ"
			>
				<AMobileAppBar />
				{children}
			</main>
			<ARightRail />
			{/*
			 * #595: ALeftNav 「投稿する」 button / AComposeShell の inline 行から
			 * dispatch される `a-compose-open` window event を listen して
			 * ComposeTweetDialog を開く。 (template) 配下の全ページで 1 つだけ存在
			 * すれば良いので layout レベルに置く。 home 以外でも投稿 button が動く。
			 */}
			<AComposeDialogHost />
		</div>
	);
}
