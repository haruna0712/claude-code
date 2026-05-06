"use client";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetFooter,
	SheetTrigger,
} from "@/components/ui/sheet";
import { useAuthNavigation } from "@/hooks";
import { useUserProfile } from "@/hooks/useUseProfile";
import type { LeftNavIconName, LeftNavLink } from "@/types";
import { HomeModernIcon } from "@heroicons/react/24/solid";
import { Bell, Compass, Home, MessageSquare, Search, User } from "lucide-react";
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
	Bell,
};

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

function LeftNavContent() {
	const pathname = usePathname();

	const { filteredNavLinks } = useAuthNavigation();
	const { profile } = useUserProfile();
	const selfHandle = profile?.username;

	return (
		<nav
			aria-label="メインナビゲーション"
			className="flex h-full flex-col gap-2 pt-16"
		>
			{filteredNavLinks.map((linkItem) => {
				const href = resolveLinkPath(linkItem, selfHandle);
				if (!href) {
					return (
						<span
							key={linkItem.label}
							aria-disabled="true"
							className="text-baby_richBlack/50 flex items-center justify-start gap-4 p-4"
						>
							<NavIcon link={linkItem} isActive={false} />
							<p className="base-medium">{linkItem.label}</p>
						</span>
					);
				}
				const isActive =
					(pathname.includes(href) && href.length > 1) || pathname === href;
				return (
					<SheetClose asChild key={linkItem.label}>
						<Link
							href={href}
							aria-current={isActive ? "page" : undefined}
							className={`${isActive ? "electricIndigo-gradient text-babyPowder rounded-lg" : "text-baby_richBlack"} flex items-center justify-start gap-4 bg-transparent p-4`}
						>
							<NavIcon link={linkItem} isActive={isActive} />
							<p className={`${isActive ? "base-bold" : "base-medium"}`}>
								{linkItem.label}
							</p>
						</Link>
					</SheetClose>
				);
			})}
		</nav>
	);
}

export default function MobileNavbar() {
	const { handleLogout, isAuthenticated } = useAuthNavigation();
	return (
		<Sheet>
			{/* a11y: Image を直接 SheetTrigger の child にすると button role が
			    付かず SR / keyboard で operable と認識されない (WCAG 4.1.2)。
			    button でラップ + aria-label でメニューを開く意図を明示。
			    sm:hidden は親 button 側に移し、icon は装飾として aria-hidden。 */}
			<SheetTrigger asChild>
				<button
					type="button"
					aria-label="メインナビゲーションを開く"
					className="cursor-pointer sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
				>
					<Image
						src="/assets/icons/mobile-menu.svg"
						alt=""
						aria-hidden="true"
						width={36}
						height={36}
						className="invert-colors"
					/>
				</button>
			</SheetTrigger>
			<SheetContent side="left" className="bg-baby_rich border-none">
				<Link href="/" className="flex items-center gap-1">
					<HomeModernIcon className="mr-2 size-11 text-lime-500" />
					<p className="h2-bold text-baby_veryBlack font-robotoSlab">
						エンジニア特化型 <span className="text-lime-500">SNS</span>
					</p>
				</Link>

				<div>
					<SheetClose asChild>
						<LeftNavContent />
					</SheetClose>

					<SheetClose asChild>
						<SheetFooter>
							{isAuthenticated ? (
								<Button
									onClick={handleLogout}
									className="lime-gradient small-medium light-border-2 btn-tertiary text-baby_richBlack min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none"
								>
									Logout
								</Button>
							) : (
								<>
									<Link href="/register">
										<Button className="electricIndigo-gradient small-medium light-border-2 btn-tertiary text-babyPowder mt-4 min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none">
											Register
										</Button>
									</Link>
									<Link href="/login">
										<Button className="lime-gradient small-medium light-border-2 btn-tertiary text-babyPowder min-h-[41px] w-full rounded-lg border px-4 py-3 shadow-none">
											Login
										</Button>
									</Link>
								</>
							)}
						</SheetFooter>
					</SheetClose>
				</div>
			</SheetContent>
		</Sheet>
	);
}
