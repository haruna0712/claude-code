"use client";

/**
 * A direction Left Nav (#550 Phase 10 POC).
 *
 * `/workspace/staticfiles/test/parts/home-a.jsx` LeftNav の Next.js 移植。
 * Linear / Vercel ベース、light theme、cyan accent、compact density (232px 幅)。
 *
 * - Brand mark + "devstream"
 * - Nav items with badge support (将来 useUnreadCount で badge を表示)
 * - Accent ツイート button
 * - Avatar pod at bottom
 *
 * 既存 `LeftNavbar` とは別実装で並存 (POC、Phase B で統一予定)。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Bell,
	Compass,
	Feather,
	FileText,
	Flame,
	Home,
	MessageSquare,
	Search,
	User,
	type LucideIcon,
} from "lucide-react";

import { useAuthNavigation } from "@/hooks";
import { useUserProfile } from "@/hooks/useUseProfile";

interface NavItem {
	href: string;
	label: string;
	Icon: LucideIcon;
	requiresAuth?: boolean;
}

const NAV_ITEMS: NavItem[] = [
	{ href: "/", label: "ホーム", Icon: Home },
	{ href: "/explore", label: "Explore", Icon: Compass },
	{ href: "/search", label: "検索", Icon: Search },
	{ href: "/notifications", label: "通知", Icon: Bell, requiresAuth: true },
	{
		href: "/messages",
		label: "メッセージ",
		Icon: MessageSquare,
		requiresAuth: true,
	},
	{ href: "/articles", label: "記事", Icon: FileText },
	{ href: "/boards", label: "掲示板", Icon: Flame },
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

export default function ALeftNav() {
	const pathname = usePathname();
	const { profile } = useUserProfile();
	const { isAuthenticated } = useAuthNavigation();

	const visibleItems = NAV_ITEMS.filter(
		(it) => !it.requiresAuth || isAuthenticated,
	);

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
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={isActive || undefined}
						className="flex items-center gap-3 rounded-md py-1.5 pr-2.5 transition-colors"
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
					</Link>
				);
			})}

			{isAuthenticated && profile && (
				<Link
					href={`/u/${profile.username}`}
					className="flex items-center gap-3 rounded-md py-1.5 pr-2.5 transition-colors"
					style={{
						paddingLeft: pathname.startsWith(`/u/${profile.username}`) ? 7 : 9,
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
				<Link
					href="/articles/new"
					aria-label="ツイート / 記事を書く"
					className="mt-3.5 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 font-medium text-white transition-opacity hover:opacity-90"
					style={{
						background: "var(--a-accent)",
						fontSize: 13.5,
						fontFamily: "inherit",
					}}
				>
					<Feather className="size-3.5" />
					投稿する
				</Link>
			)}

			<div className="mt-auto flex items-center gap-2 rounded-lg border border-[color:var(--a-border)] p-2">
				{profile ? (
					<>
						<div
							className="grid size-7 place-items-center rounded-full font-semibold text-white"
							style={{ background: "hsl(200 70% 32%)", fontSize: 11.5 }}
							aria-hidden
						>
							{(profile.display_name || profile.username)
								.slice(0, 2)
								.toUpperCase()}
						</div>
						<div className="min-w-0 flex-1 leading-tight">
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
					</>
				) : (
					<Link
						href="/login"
						className="flex-1 text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)]"
						style={{ fontSize: 12.5 }}
					>
						ログインして始める →
					</Link>
				)}
			</div>
		</aside>
	);
}
