/**
 * RightSidebar — desktop right rail with TrendingTags + WhoToFollow.
 *
 * MVP scope (P2-17 / Issue #189):
 *   - Visible only at lg+ (≥1024px). Tablet shows nothing; the mobile
 *     end-of-feed collapse (SPEC §16.3) ships as a follow-up.
 */

import TrendingTags from "@/components/sidebar/TrendingTags";
import WhoToFollow from "@/components/sidebar/WhoToFollow";

interface RightSidebarProps {
	isAuthenticated: boolean;
}

export default function RightSidebar({ isAuthenticated }: RightSidebarProps) {
	return (
		<aside
			aria-label="サイドバー"
			className="hidden lg:block w-80 shrink-0 space-y-4 px-4 py-6"
		>
			<TrendingTags />
			<WhoToFollow isAuthenticated={isAuthenticated} />
		</aside>
	);
}
