import LeftNavbar from "@/components/shared/navbar/LeftNavbar";
import Navbar from "@/components/shared/navbar/Navbar";
import RightSidebar from "@/components/sidebar/RightSidebar";
import { cookies } from "next/headers";
import React from "react";

interface LayoutProps {
	children: React.ReactNode;
}

export default function layout({ children }: LayoutProps) {
	// #316: ログイン済かを cookie (`logged_in`) で判定して RightSidebar (WhoToFollow
	// + TrendingTags) に渡す。/users/me/ を SSR で fetch する手もあるが、cookie
	// 1 個読むだけで十分 (本判定は WhoToFollow が personalized recommendation
	// を出すかの user-facing toggle で、auth 必須 endpoint は side-by-side で
	// 401 するため二重防御済)。
	const isAuthenticated = cookies().get("logged_in")?.value === "true";

	return (
		<main className="bg-baby_veryBlack relative">
			<Navbar />
			<div className="flex">
				{/* #297: 実体配線。sm 未満は MobileNavbar (Sheet) に委譲、sm 以上で表示。 */}
				<LeftNavbar />
				<section className="flex min-h-screen flex-1 flex-col px-4 pb-6 pt-24 sm:px-6 lg:px-8 lg:pt-32">
					<div>{children}</div>
				</section>
				{/* #316: 全 (template) 配下 page で WhoToFollow / TrendingTags を表示。
				    旧実装は /explore のみで mount されており、home / search / u 等で
				    他ユーザ発見導線が無かった。lg+ で表示、それ以下では非表示。 */}
				<RightSidebar isAuthenticated={isAuthenticated} />
			</div>
		</main>
	);
}
