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
import AMainWidth from "@/components/layout-a/AMainWidth";
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
			{/* #782: `maxWidth: 800` の固定制約を `AMainWidth` (client) に委譲。
			    article editor route だけ max-width を 1280 に広げて本文を書きやすく
			    する。 他 route は 800px の TL 用幅を維持 (= デグレ防止)。 */}
			<main
				// mobile (< sm) では fixed bottom-nav が content に被らないよう、
				// safe-area を含む余白と scroll padding を main 側に確保する。
				className="flex w-full min-w-0 scroll-pb-28 flex-col pb-28 sm:scroll-pb-0 sm:border-r sm:border-[color:var(--a-border)] sm:pb-0"
				aria-label="メインコンテンツ"
			>
				<AMobileAppBar />
				<AMainWidth>{children}</AMainWidth>
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
