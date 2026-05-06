import { HomeModernIcon } from "@heroicons/react/24/solid";
import Link from "next/link";
import React from "react";
import ThemeSwitcher from "./ThemeSwitcher";
import MobileNavbar from "./MobileNavbar";
import AuthAvatar from "@/components/shared/navbar/AuthAvatar";

export default function Navbar() {
	return (
		<nav className="bg-baby_rich border-b-platinum shadow-platinum fixed z-50 flex w-full items-center justify-between gap-3 border-b-2 p-4 dark:border-b-0 dark:shadow-none sm:gap-5 sm:p-6 lg:px-12">
			<Link href="/" className="flex shrink-0 items-center">
				<HomeModernIcon className="size-9 text-lime-500 sm:mr-2 sm:size-11" />
				<p className="h2-bold font-robotoSlab text-veryBlack dark:text-babyPowder hidden sm:block">
					エンジニア特化型 <span className="text-lime-500">SNS</span>
				</p>
			</Link>

			{/* #396: グローバル検索 box は RightSidebar 上部に移設。Navbar は
			    シンプルに保つ (logo + theme + auth + mobile) */}

			<div className="flex shrink-0 items-center gap-3 sm:gap-5 lg:gap-6">
				<ThemeSwitcher />
				<AuthAvatar />
				<MobileNavbar />
			</div>
		</nav>
	);
}
