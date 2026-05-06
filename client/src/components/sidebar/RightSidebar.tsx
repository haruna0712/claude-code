"use client";

/**
 * RightSidebar — desktop right rail with HeaderSearchBox + TrendingTags + WhoToFollow.
 *
 * Scope:
 *   - lg+ (≥1024px) のみ表示
 *   - #396: 上部に HeaderSearchBox (Navbar から移設)、sticky で常時可視
 *   - #189: TrendingTags / WhoToFollow
 *
 * #419: `isAuthenticated` を SSR 経由 (layout の `cookies()`) ではなく、
 * client-side で `document.cookie` から読む。Next.js App Router の layout は
 * CSR 遷移で再 render されないため、login → navigate のあとに古い false 値が
 * 残ってしまう (WhoToFollow が anonymous 経路を叩く副作用)。本コンポーネントを
 * `'use client'` 化して mount 時に最新の cookie を読む。
 */

import HeaderSearchBox from "@/components/shared/navbar/HeaderSearchBox";
import TrendingTags from "@/components/sidebar/TrendingTags";
import WhoToFollow from "@/components/sidebar/WhoToFollow";
import { getCookie } from "cookies-next";
import { useEffect, useState } from "react";

interface RightSidebarProps {
	/** SSR で `cookies()` から得た初期値。CSR mount 後は document.cookie で再評価する。 */
	initialIsAuthenticated?: boolean;
}

export default function RightSidebar({
	initialIsAuthenticated = false,
}: RightSidebarProps) {
	const [isAuthenticated, setIsAuthenticated] = useState(
		initialIsAuthenticated,
	);

	useEffect(() => {
		// mount 時に最新の cookie を読む。client-side navigation で layout が
		// 再 render されない場合でも、本 component (children) は再 mount される
		// ので、ここで再評価されたら isAuthenticated が更新される。
		const cookieIsLoggedIn = getCookie("logged_in") === "true";
		setIsAuthenticated(cookieIsLoggedIn);
	}, []);

	return (
		<aside
			aria-label="サイドバー"
			className="hidden w-80 shrink-0 space-y-4 px-4 py-6 lg:block"
		>
			{/* #396: 検索 box を最上部 sticky で配置。スクロールしても残る */}
			<div className="sticky top-4 z-10 bg-background/95 pb-1 backdrop-blur-sm">
				<HeaderSearchBox />
			</div>
			<TrendingTags />
			<WhoToFollow isAuthenticated={isAuthenticated} />
		</aside>
	);
}
