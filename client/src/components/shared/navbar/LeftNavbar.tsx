"use client";
import SettingsMenu from "@/components/shared/navbar/SettingsMenu";
import ComposeTweetDialog from "@/components/tweets/ComposeTweetDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuthNavigation } from "@/hooks";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { useUserProfile } from "@/hooks/useUseProfile";
import type { LeftNavIconName, LeftNavLink } from "@/types";
import { HomeModernIcon } from "@heroicons/react/24/solid";
import {
	Bell,
	CircleUser,
	Compass,
	FileText,
	Handshake,
	Home,
	MessageSquare,
	MessagesSquare,
	Plus,
	Search,
	User,
	UserSearch,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType, useEffect, useState } from "react";

const ICON_MAP: Record<
	LeftNavIconName,
	ComponentType<{ className?: string }>
> = {
	Home,
	Compass,
	Search,
	MessageSquare,
	User,
	UserSearch,
	Bell,
	MessagesSquare,
	FileText,
	Handshake,
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
	const selfDisplayName = profile?.display_name?.trim() || profile?.username;
	const [composeOpen, setComposeOpen] = useState(false);
	// #412: 認証済みのみ未読数を polling
	const { count: unreadCount } = useUnreadCount(isAuthenticated);

	// logout / 認証失効時に dialog 状態が残らないようリセット (TS-rev MEDIUM)
	useEffect(() => {
		if (!isAuthenticated && composeOpen) setComposeOpen(false);
	}, [isAuthenticated, composeOpen]);

	return (
		<section className="bg-baby_rich light-border custom-scrollbar shadow-platinum sticky left-0 top-0 flex h-screen flex-col justify-between overflow-y-auto border-r p-6 dark:shadow-none max-sm:hidden lg:w-[297px]">
			{/* #408: 旧 Navbar から移設したロゴ。LeftNavbar 上部に置く (X / karotter
			    準拠の 3 カラムレイアウト)。 */}
			<Link
				href="/"
				aria-label="ホームへ"
				className="mb-4 flex shrink-0 items-center gap-2"
			>
				<HomeModernIcon
					className="size-9 text-lime-500 lg:size-10"
					aria-hidden="true"
				/>
				<p className="font-robotoSlab text-veryBlack dark:text-babyPowder hidden text-lg font-bold lg:block">
					エンジニア特化型 <span className="text-lime-500">SNS</span>
				</p>
			</Link>

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
					// path-prefix match: 「`/search` が `/search/users` も active 化させる」
					// 問題 (typescript-reviewer P12-04 HIGH) を回避するため、完全一致または
					// `/<segment>/...` で始まるかどうかを active 扱いにする。
					const isActive =
						pathname === href ||
						(href.length > 1 && pathname.startsWith(`${href}/`));
					return (
						<Link
							href={href}
							key={linkItem.label}
							aria-label={
								linkItem.path === "/notifications" && unreadCount > 0
									? `${linkItem.label} (${unreadCount} 件の未読)`
									: linkItem.label
							}
							aria-current={isActive ? "page" : undefined}
							className={`${
								isActive
									? "electricIndigo-gradient text-babyPowder rounded-lg"
									: "text-baby_richBlack hover:bg-baby_richBlack/5"
							} flex items-center justify-start gap-4 bg-transparent p-4 transition`}
						>
							<NavIcon link={linkItem} isActive={isActive} />
							{/* lg 以下では label を視覚的に隠すが、a11y のため Link 自体に
							    aria-label を付与している (max-lg で text を display:none に
							    した場合も SR からは label が display:none に
							    した場合も SR からは label が読み上げられる)。 */}
							<p
								aria-hidden="true"
								className={`${isActive ? "base-bold" : "base-medium"} max-lg:hidden`}
							>
								{linkItem.label}
							</p>
							{/* #412: 通知 link の右側に未読バッジ。0 件のときは出さない。 */}
							{linkItem.path === "/notifications" && unreadCount > 0 ? (
								<span
									aria-hidden="true"
									className="ml-auto inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white max-lg:absolute max-lg:right-2 max-lg:top-2 max-lg:ml-0"
								>
									{unreadCount > 99 ? "99+" : unreadCount}
								</span>
							) : null}
						</Link>
					);
				})}

				{/* #396: + ポストボタン (認証済みのみ)。lg+ は label "ポスト"、
				    sm〜lg は icon のみ。click → ComposeTweetDialog を open。
				    a11y: aria-label を可視テキスト "ポスト" と一致させる (SC 2.5.3)。 */}
				{isAuthenticated ? (
					<Button
						type="button"
						onClick={() => setComposeOpen(true)}
						aria-label="ポスト"
						className="electricIndigo-gradient text-babyPowder mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full text-base font-semibold shadow-md hover:opacity-90 max-lg:size-12 max-lg:rounded-full max-lg:p-0"
					>
						<Plus className="size-5 shrink-0" aria-hidden="true" />
						<span className="max-lg:hidden">ポスト</span>
					</Button>
				) : null}
			</nav>

			{isAuthenticated ? (
				<div className="flex flex-col gap-3">
					{/* #406: Logout 単独ボタンを SettingsMenu (テーマ切替 + ログアウト) に
					    置き換え。Navbar から ThemeSwitcher を撤去したのに伴いここに
					    集約する。 */}
					<SettingsMenu onLogout={handleLogout} />

					{/* #396: 自分プロフィール chip (X 風 — avatar + display_name + @handle)。
					    handle 未取得時は表示しない (link 先が決まらないため)。
					    a11y: aria-label を可視テキストで開始 (SC 2.5.3)。
					    アイコンのみが見える max-lg では @handle のみで十分なので
					    `${selfDisplayName} @${selfHandle}` 形式に統一。 */}
					{selfHandle ? (
						<Link
							href={`/u/${selfHandle}`}
							aria-label={`${selfDisplayName} @${selfHandle} のプロフィール`}
							className="hover:bg-baby_richBlack/5 flex items-center gap-3 rounded-full p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Avatar className="size-10 shrink-0">
								<AvatarImage src={profile?.avatar_url} alt="" />
								<AvatarFallback>
									<CircleUser className="size-6" aria-hidden="true" />
								</AvatarFallback>
							</Avatar>
							<div className="flex min-w-0 flex-1 flex-col text-left max-lg:hidden">
								<span className="truncate text-sm font-semibold text-foreground">
									{selfDisplayName}
								</span>
								<span className="truncate text-xs text-muted-foreground">
									@{selfHandle}
								</span>
							</div>
						</Link>
					) : null}
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

			{isAuthenticated ? (
				<ComposeTweetDialog open={composeOpen} onOpenChange={setComposeOpen} />
			) : null}
		</section>
	);
}
