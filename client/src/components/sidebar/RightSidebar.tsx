/**
 * RightSidebar — desktop right rail with HeaderSearchBox + TrendingTags + WhoToFollow.
 *
 * Scope:
 *   - lg+ (≥1024px) のみ表示
 *   - #396: 上部に HeaderSearchBox (Navbar から移設)、sticky で常時可視
 *   - #189: TrendingTags / WhoToFollow
 */

import HeaderSearchBox from "@/components/shared/navbar/HeaderSearchBox";
import TrendingTags from "@/components/sidebar/TrendingTags";
import WhoToFollow from "@/components/sidebar/WhoToFollow";

interface RightSidebarProps {
	isAuthenticated: boolean;
}

export default function RightSidebar({ isAuthenticated }: RightSidebarProps) {
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
