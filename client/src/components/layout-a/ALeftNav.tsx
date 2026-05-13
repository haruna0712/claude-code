"use client";

/**
 * A direction Left Nav (#550 Phase 10 POC, polished in #557 Phase B-0-6).
 *
 * `/workspace/staticfiles/test/parts/home-a.jsx` LeftNav の Next.js 移植。
 * Linear / Vercel ベース、light theme、cyan accent、compact density (232px 幅)。
 *
 * #557 で追加:
 *  - 通知 badge を `useUnreadCount` で wire (cyan pill, 99+ で打ち切り)
 *  - 全 NavItem / pod に `focus-visible:outline-2 outline-[var(--a-accent)]` (WCAG 2.4.7)
 *  - 非 active 時の `hover:bg-[var(--a-bg-muted)]` (現在 transparent で hover 無反応)
 *  - Explore icon を Compass → Hash (reference home-a.jsx の `ic:'hash'` に揃える)
 *
 * 既存 `LeftNavbar` とは別実装で並存 (POC、Phase B で統一予定)。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Bell,
	ChevronDown,
	Feather,
	FileText,
	Flame,
	Handshake,
	Hash,
	Home,
	LogOut,
	MessageSquare,
	Search,
	Settings,
	User,
	UserSearch,
	Users,
	type LucideIcon,
} from "lucide-react";

import { dispatchAComposeOpen } from "@/components/layout-a/AComposeDialogHost";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthNavigation } from "@/hooks";
import { useUnreadCount } from "@/hooks/useUnreadCount";
import { useUserProfile } from "@/hooks/useUseProfile";

interface NavItemDef {
	href: string;
	label: string;
	Icon: LucideIcon;
	requiresAuth?: boolean;
	badgeKey?: "notifications";
}

const NAV_ITEMS: NavItemDef[] = [
	{ href: "/", label: "ホーム", Icon: Home },
	{ href: "/explore", label: "Explore", Icon: Hash },
	{ href: "/search", label: "検索", Icon: Search },
	// Phase 12 (P12-04 / #676): 汎用ユーザー検索。 既存「検索」 は tweet 用なので別 link。
	{ href: "/search/users", label: "ユーザー検索", Icon: UserSearch },
	{
		href: "/notifications",
		label: "通知",
		Icon: Bell,
		requiresAuth: true,
		badgeKey: "notifications",
	},
	{
		href: "/messages",
		label: "メッセージ",
		Icon: MessageSquare,
		requiresAuth: true,
	},
	{ href: "/articles", label: "記事", Icon: FileText },
	{ href: "/boards", label: "掲示板", Icon: Flame },
	// Phase 11 11-A (P11-09 follow-up): home (A direction) でも「メンター募集」 を
	// 1 click 到達できるようにする。 既存 `leftNavLinks` (LeftNavbar / MobileNavbar
	// 用、 X 風レイアウト) には追加済だが、 home が使う ALeftNav は別 list を持つ
	// (#550 POC) ため、 ここにも明示する。
	{ href: "/mentor/wanted", label: "メンター募集", Icon: Handshake },
	// Phase 11-B (P11-14): mentor 検索 (anon 可)。 「募集」 と区別する label。
	{ href: "/mentors", label: "メンターを探す", Icon: Users },
];

function BrandMark({ size = 22 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<rect x="2" y="2" width="20" height="20" rx="5" fill="#0a0a0a" />
			<path
				d="M7 9.5h7a2.5 2.5 0 010 5h-4a2.5 2.5 0 000 5h7"
				stroke="#0ea5e9"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function NavBadge({ count }: { count: number }) {
	if (count <= 0) return null;
	const label = count > 99 ? "99+" : String(count);
	return (
		<span
			aria-label={`未読 ${label} 件`}
			className="ml-auto inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-white"
			style={{
				background: "var(--a-accent)",
				fontFamily: "var(--a-font-mono)",
				fontSize: 10.5,
				lineHeight: "16px",
				height: 16,
			}}
		>
			{label}
		</span>
	);
}

export default function ALeftNav() {
	const pathname = usePathname();
	const { profile } = useUserProfile();
	const { isAuthenticated, handleLogout } = useAuthNavigation();
	// 通知 badge: ログイン中のみ polling (`useUnreadCount` 側で enabled=false なら no-op)
	const { count: notifUnread } = useUnreadCount(isAuthenticated);

	const visibleItems = NAV_ITEMS.filter(
		(it) => !it.requiresAuth || isAuthenticated,
	);

	const itemBadgeCount = (key: NavItemDef["badgeKey"]): number => {
		if (key === "notifications") return notifUnread;
		return 0;
	};

	return (
		<aside
			aria-label="メインナビゲーション"
			className="hidden h-screen flex-col gap-0.5 border-r border-[color:var(--a-border)] bg-[color:var(--a-bg)] px-3 py-3.5 sm:flex"
			style={{ width: 232, fontFamily: "var(--a-font-sans)" }}
		>
			<div className="flex items-center gap-2 px-2 pb-3 pt-1">
				<BrandMark size={22} />
				<span
					className="font-semibold tracking-tight text-[color:var(--a-text)]"
					style={{ fontSize: 14.5 }}
				>
					devstream
				</span>
			</div>

			{visibleItems.map((item) => {
				const isActive =
					item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
				const badgeCount = itemBadgeCount(item.badgeKey);
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={isActive || undefined}
						className={`flex items-center gap-3 rounded-md py-1.5 pr-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
							isActive ? "" : "hover:bg-[color:var(--a-bg-muted)]"
						}`}
						style={{
							paddingLeft: 7,
							borderLeft: `2px solid ${
								isActive ? "var(--a-accent)" : "transparent"
							}`,
							background: isActive ? "var(--a-bg-muted)" : "transparent",
							color: isActive ? "var(--a-text)" : "var(--a-text-muted)",
							fontSize: 13.5,
						}}
					>
						<item.Icon className="size-4" />
						<span className="flex-1 truncate">{item.label}</span>
						<NavBadge count={badgeCount} />
					</Link>
				);
			})}

			{isAuthenticated && profile && (
				<Link
					href={`/u/${profile.username}`}
					aria-current={
						pathname.startsWith(`/u/${profile.username}`) || undefined
					}
					className={`flex items-center gap-3 rounded-md py-1.5 pr-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
						pathname.startsWith(`/u/${profile.username}`)
							? ""
							: "hover:bg-[color:var(--a-bg-muted)]"
					}`}
					style={{
						paddingLeft: 7,
						borderLeft: `2px solid ${
							pathname.startsWith(`/u/${profile.username}`)
								? "var(--a-accent)"
								: "transparent"
						}`,
						background: pathname.startsWith(`/u/${profile.username}`)
							? "var(--a-bg-muted)"
							: "transparent",
						color: pathname.startsWith(`/u/${profile.username}`)
							? "var(--a-text)"
							: "var(--a-text-muted)",
						fontSize: 13.5,
					}}
				>
					<User className="size-4" />
					<span className="flex-1">プロフィール</span>
				</Link>
			)}

			{isAuthenticated && (
				<button
					type="button"
					onClick={dispatchAComposeOpen}
					aria-label="ツイートを投稿する"
					className="mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{
						background: "var(--a-accent)",
						fontSize: 13.5,
						fontFamily: "inherit",
					}}
				>
					<Feather className="size-3.5" />
					投稿する
				</button>
			)}

			{profile ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={`${profile.display_name || profile.username} のメニューを開く`}
							className="mt-auto flex items-center gap-2 rounded-lg border border-[color:var(--a-border)] p-2 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
						>
							<div
								className="grid size-7 place-items-center rounded-full font-semibold text-white"
								style={{ background: "hsl(200 70% 32%)", fontSize: 11.5 }}
								aria-hidden
							>
								{(profile.display_name || profile.username)
									.slice(0, 2)
									.toUpperCase()}
							</div>
							<div className="min-w-0 flex-1 text-left leading-tight">
								<div
									className="truncate font-medium text-[color:var(--a-text)]"
									style={{ fontSize: 12.5 }}
								>
									{profile.display_name || profile.username}
								</div>
								<div
									className="truncate text-[color:var(--a-text-subtle)]"
									style={{
										fontSize: 11.5,
										fontFamily: "var(--a-font-mono)",
									}}
								>
									@{profile.username}
								</div>
							</div>
							<ChevronDown
								className="size-3.5 text-[color:var(--a-text-subtle)]"
								aria-hidden
							/>
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" side="top" className="w-56">
						<DropdownMenuItem asChild>
							<Link
								href={`/u/${profile.username}`}
								className="flex items-center gap-2"
							>
								<User className="size-4" />
								プロフィール
							</Link>
						</DropdownMenuItem>
						<DropdownMenuItem asChild>
							<Link
								href="/settings/profile"
								className="flex items-center gap-2"
							>
								<Settings className="size-4" />
								設定
							</Link>
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onSelect={() => handleLogout()}
							className="flex items-center gap-2 text-[color:var(--a-danger)]"
						>
							<LogOut className="size-4" />
							ログアウト
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				<div className="mt-auto flex items-center gap-2 rounded-lg border border-[color:var(--a-border)] p-2">
					<Link
						href="/login"
						className="flex-1 text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
						style={{ fontSize: 12.5 }}
					>
						ログインして始める →
					</Link>
				</div>
			)}
		</aside>
	);
}
