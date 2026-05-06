import { HomeModernIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import React from "react";
import MobileNavbar from "./MobileNavbar";

export default function Navbar() {
	return (
		<nav className="bg-baby_rich border-b-platinum shadow-platinum fixed z-50 flex w-full items-center justify-between gap-3 border-b-2 p-4 dark:border-b-0 dark:shadow-none sm:gap-5 sm:p-6 lg:px-12">
			<Link href="/" className="flex shrink-0 items-center">
				<HomeModernIcon className="size-9 text-lime-500 sm:mr-2 sm:size-11" />
				<p className="h2-bold font-robotoSlab text-veryBlack dark:text-babyPowder hidden sm:block">
					エンジニア特化型 <span className="text-lime-500">SNS</span>
				</p>
			</Link>

			{/* #406: AuthAvatar / ThemeSwitcher を撤去。
			    - AuthAvatar: LeftNavbar 下部の self profile chip と冗長
			    - ThemeSwitcher: RightSidebar の検索 box と被って入力を阻害していた
			      → LeftNavbar の「設定」メニュー配下に移設 (SettingsMenu 参照) */}

			{/* sm 未満は MobileNavbar (Sheet) に nav リンク群を委ねる */}
			<MobileNavbar />
		</nav>
	);
}
