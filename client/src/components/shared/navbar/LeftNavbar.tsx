"use client";
import { Button } from "@/components/ui/button";
import { useAuthNavigation } from "@/hooks";
import { useUserProfile } from "@/hooks/useUseProfile";
import type { LeftNavIconName, LeftNavLink } from "@/types";
import { Compass, Home, MessageSquare, Search, User } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

const ICON_MAP: Record<
	LeftNavIconName,
	ComponentType<{ className?: string }>
> = {
	Home,
	Compass,
	Search,
	MessageSquare,
	User,
};

/** isProfile link は self handle を埋めて返す。handle 未取得時は null。 */
function resolveLinkPath(
	link: LeftNavLink,
	selfHandle: string | undefined,
): string | null {
	if (!link.isProfile) return link.path;
	if (!selfHandle) return null;
	return `/u/${selfHandle}`;
}

function NavIcon({ link, isActive }: { link: LeftNavLink; isActive: boolean }) {
	if (link.iconName) {
		const Icon = ICON_MAP[link.iconName];
		return (
			<Icon
				className={`size-[22px] ${isActive ? "text-babyPowder" : "text-baby_richBlack dark:text-babyPowder"}`}
			/>
		);
	}
	if (link.imgLocation) {
		return (
			<Image
				src={link.imgLocation}
				alt=""
				width={22}
				height={22}
				className={`${isActive ? "" : "color-invert"}`}
			/>
		);
	}
	return null;
}

export default function LeftNavbar() {
	const pathname = usePathname();
	const { handleLogout, filteredNavLinks, isAuthenticated } =
		useAuthNavigation();
	const { profile } = useUserProfile();
	const selfHandle = profile?.username;

	return (
		<section className="bg-baby_rich light-border custom-scrollbar shadow-platinum sticky left-0 top-0 flex h-screen flex-col justify-between overflow-y-auto border-r p-6 pt-36 max-sm:hidden lg:w-[297px] dark:shadow-none">
			<nav
				aria-label="メインナビゲーション"
				className="flex flex-1 flex-col gap-2"
			>
				{filteredNavLinks.map((linkItem) => {
					const href = resolveLinkPath(linkItem, selfHandle);
					if (!href) {
						// プロフィール link で self handle が未取得の場合は disabled 扱い
						return (
							<span
								key={linkItem.label}
								aria-disabled="true"
								title="プロフィール情報を取得中..."
								className="text-baby_richBlack/50 flex items-center justify-start gap-4 p-4"
							>
								<NavIcon link={linkItem} isActive={false} />
								<p className="base-medium max-lg:hidden">{linkItem.label}</p>
							</span>
						);
					}
					const isActive =
						(pathname.includes(href) && href.length > 1) || pathname === href;
					return (
						<Link
							href={href}
							key={linkItem.label}
							aria-current={isActive ? "page" : undefined}
							className={`${
								isActive
									? "electricIndigo-gradient text-babyPowder rounded-lg"
									: "text-baby_richBlack hover:bg-baby_richBlack/5"
							} flex items-center justify-start gap-4 bg-transparent p-4 transition`}
						>
							<NavIcon link={linkItem} isActive={isActive} />
							<p
								className={`${isActive ? "base-bold" : "base-medium"} max-lg:hidden`}
							>
								{linkItem.label}
							</p>
						</Link>
					);
				})}
			</nav>

			{isAuthenticated ? (
				<div className="flex flex-col gap-3">
					<Button
						onClick={handleLogout}
						className="lime-gradient small-medium light-border-2 btn-tertiary text-baby_ballon min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none"
					>
						Log Out
					</Button>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					<Link href="/login">
						<Button className="lime-gradient small-medium light-border-2 btn-tertiary text-baby_ballon min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none">
							Login
						</Button>
					</Link>
					<Link href="/register">
						<Button className="electricIndigo-gradient small-medium light-border-2 btn-tertiary text-baby_ballon min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none">
							Register
						</Button>
					</Link>
				</div>
			)}
		</section>
	);
}
