import LeftNavbar from "@/components/shared/navbar/LeftNavbar";
import MobileNavbar from "@/components/shared/navbar/MobileNavbar";
import RightSidebar from "@/components/sidebar/RightSidebar";
import { cookies } from "next/headers";
import React from "react";

interface LayoutProps {
	children: React.ReactNode;
}

export default function layout({ children }: LayoutProps) {
	// #316: ログイン済かを cookie (`logged_in`) で判定して RightSidebar (WhoToFollow
	// + TrendingTags) に渡す。
	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	return (
		<main className="bg-baby_veryBlack relative">
			{/* #408: Navbar (logo + 上部固定 bar) を撤去。ロゴは LeftNavbar 上部へ移設。
			    mobile (< sm) のハンバーガーは左上に独立 fixed で残す。 */}
			<div className="fixed left-3 top-3 z-50 sm:hidden">
				<MobileNavbar />
			</div>
			<div className="flex">
				<LeftNavbar />
				<section className="flex min-h-screen flex-1 flex-col px-4 pb-6 pt-6 sm:px-6 lg:px-8">
					<div>{children}</div>
				</section>
				{/* #316: 全 (template) 配下 page で WhoToFollow / TrendingTags を表示。
				    lg+ で表示、それ以下では非表示。 */}
				<RightSidebar isAuthenticated={isAuthenticated} />
			</div>
		</main>
	);
}
