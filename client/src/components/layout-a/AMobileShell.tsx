"use client";

/**
 * A direction Mobile Shell (#552 Phase B-0-1).
 *
 * gan-evaluator Blocker 1 への対応。stg で < md (375px / 320px) のときに
 * ALeftNav / ARightRail が幅 0 で消えて nav どこにも行けない問題を解消。
 *
 * - 上部 app bar: BrandMark + 「devstream」 + ハンバーガー
 * - ハンバーガー click で Sheet (左 drawer) が開き、ALeftNav と同 nav 内容
 * - 下部 bottom-tab bar: ホーム / Explore / 通知 / メッセージ / プロフィール
 *   (auth に応じて表示)
 *
 * 表示条件: `< sm` (640px 未満)。`sm` 以上では ALayout のサイドカラムを使う。
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
	Bell,
	Compass,
	FileText,
	Flame,
	Handshake,
	Home,
	MessageSquare,
	Menu as MenuIcon,
	Search,
	Sparkles,
	User,
	UserSearch,
	X,
	type LucideIcon,
} from "lucide-react";

import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuthNavigation } from "@/hooks";
import { useUserProfile } from "@/hooks/useUseProfile";
import { resolveActiveHref } from "@/lib/nav-active";

interface BottomTabItem {
	href: string;
	label: string;
	Icon: LucideIcon;
	requiresAuth?: boolean;
}

const BOTTOM_TABS: BottomTabItem[] = [
	{ href: "/", label: "ホーム", Icon: Home },
	{ href: "/explore", label: "Explore", Icon: Compass },
	{ href: "/notifications", label: "通知", Icon: Bell, requiresAuth: true },
	{ href: "/messages", label: "DM", Icon: MessageSquare, requiresAuth: true },
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

/**
 * Mobile 上部 app bar。BrandMark + hamburger trigger。
 * Sheet 内に ALeftNav の中身を再利用する代わりに、簡易な drawer 用 nav を埋め込む。
 */
export default function AMobileAppBar({ children }: { children?: ReactNode }) {
	const [open, setOpen] = useState(false);
	const pathname = usePathname();
	const { profile } = useUserProfile();
	const { isAuthenticated, handleLogout } = useAuthNavigation();

	return (
		<>
			<header
				role="banner"
				className="flex items-center gap-2 border-b px-3 py-2 sm:hidden"
				style={{
					borderColor: "var(--a-border)",
					background: "var(--a-bg)",
					fontFamily: "var(--a-font-sans)",
				}}
			>
				<Sheet open={open} onOpenChange={setOpen}>
					<SheetTrigger asChild>
						<button
							type="button"
							aria-label="メニューを開く"
							className="inline-flex size-9 items-center justify-center rounded-md"
							style={{ color: "var(--a-text-muted)" }}
						>
							<MenuIcon className="size-5" />
						</button>
					</SheetTrigger>
					<SheetContent
						side="left"
						className="w-[260px] border-r-0 p-0"
						style={{
							background: "var(--a-bg)",
							color: "var(--a-text)",
							fontFamily: "var(--a-font-sans)",
						}}
					>
						<div className="flex h-full flex-col gap-0.5 px-3 py-3.5">
							<div className="flex items-center gap-2 px-2 pb-3 pt-1">
								<BrandMark size={22} />
								<span
									className="flex-1 font-semibold tracking-tight"
									style={{ fontSize: 14.5 }}
								>
									devstream
								</span>
								<button
									type="button"
									aria-label="閉じる"
									onClick={() => setOpen(false)}
									className="text-[color:var(--a-text-subtle)]"
								>
									<X className="size-4" />
								</button>
							</div>
							<DrawerNav onItemClick={() => setOpen(false)} />
							{isAuthenticated && (
								<button
									type="button"
									onClick={() => {
										setOpen(false);
										handleLogout();
									}}
									className="mt-3 inline-flex items-center justify-center rounded-md px-3 py-2 font-medium"
									style={{
										border: "1px solid var(--a-border)",
										color: "var(--a-text-muted)",
										fontSize: 13.5,
									}}
								>
									ログアウト
								</button>
							)}
						</div>
					</SheetContent>
				</Sheet>
				<div className="flex flex-1 items-center gap-2">
					<BrandMark size={20} />
					<span
						className="font-semibold tracking-tight"
						style={{ fontSize: 14, color: "var(--a-text)" }}
					>
						devstream
					</span>
				</div>
				{children}
			</header>

			<nav
				aria-label="モバイルタブ"
				role="navigation"
				className="fixed inset-x-0 bottom-0 z-30 flex border-t sm:hidden"
				style={{
					borderColor: "var(--a-border)",
					background: "rgba(255,255,255,0.92)",
					backdropFilter: "blur(8px)",
					fontFamily: "var(--a-font-sans)",
				}}
			>
				{(() => {
					const visible = BOTTOM_TABS.filter(
						(t) => !t.requiresAuth || isAuthenticated,
					);
					const activeHref = resolveActiveHref(visible, pathname);
					return visible.map((tab) => {
						const isActive = tab.href === activeHref;
						return (
							<Link
								key={tab.href}
								href={tab.href}
								aria-current={isActive ? "page" : undefined}
								className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors focus-visible:outline-none"
								style={{
									color: isActive ? "var(--a-accent)" : "var(--a-text-muted)",
									fontSize: 10.5,
								}}
							>
								<tab.Icon className="size-5" />
								<span>{tab.label}</span>
							</Link>
						);
					});
				})()}
				{isAuthenticated && profile ? (
					<Link
						href={`/u/${profile.username}`}
						aria-current={
							pathname.startsWith(`/u/${profile.username}`) || undefined
						}
						className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
						style={{
							color: pathname.startsWith(`/u/${profile.username}`)
								? "var(--a-accent)"
								: "var(--a-text-muted)",
							fontSize: 10.5,
						}}
					>
						<User className="size-5" />
						<span>マイページ</span>
					</Link>
				) : (
					<Link
						href="/login"
						className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
						style={{ color: "var(--a-text-muted)", fontSize: 10.5 }}
					>
						<User className="size-5" />
						<span>ログイン</span>
					</Link>
				)}
			</nav>

			{/* Bottom-tab 分の余白 (固定の 56px) を main 末尾に確保するための pad */}
			<div className="pb-14 sm:hidden" aria-hidden />
		</>
	);
}

/**
 * Drawer の中身 — ALeftNav と同 nav items を簡略表示。
 * Sheet オープン中はモーダルなので shadcn の navigation セマンティクスは不要、
 * link list で十分。
 */
function DrawerNav({ onItemClick }: { onItemClick: () => void }) {
	const pathname = usePathname();
	const { isAuthenticated } = useAuthNavigation();
	// Drawer は全 nav を網羅 (bottom-tab で出ない記事 / 掲示板 / 検索 / メンター も含む)。
	// `leftNavLinks` (constants/index.ts) と等価な構成を mobile drawer でも保つよう
	// 維持する責務がある — 新 route を leftNavLinks に追加したらここにも追加する
	// (#686 mobile 動線漏れ防止)。
	const items: BottomTabItem[] = [
		{ href: "/", label: "ホーム", Icon: Home },
		{ href: "/explore", label: "Explore", Icon: Compass },
		{ href: "/search", label: "検索", Icon: Search },
		{ href: "/search/users", label: "ユーザー検索", Icon: UserSearch },
		{ href: "/notifications", label: "通知", Icon: Bell, requiresAuth: true },
		{
			href: "/messages",
			label: "メッセージ",
			Icon: MessageSquare,
			requiresAuth: true,
		},
		{ href: "/articles", label: "記事", Icon: FileText },
		{ href: "/boards", label: "掲示板", Icon: Flame },
		{ href: "/mentor/wanted", label: "メンター募集", Icon: Handshake },
		// Phase 14 (P14-05): Claude Agent。 leftNavLinks と同 entry を
		// mobile drawer にも明示する。
		{
			href: "/agent",
			label: "Agent",
			Icon: Sparkles,
			requiresAuth: true,
		},
	];

	return (
		<div className="flex flex-col gap-0.5">
			{(() => {
				const visible = items.filter(
					(it) => !it.requiresAuth || isAuthenticated,
				);
				const activeHref = resolveActiveHref(visible, pathname);
				return visible.map((item) => {
					const isActive = item.href === activeHref;
					return (
						<Link
							key={item.href}
							href={item.href}
							onClick={onItemClick}
							aria-current={isActive ? "page" : undefined}
							className="flex items-center gap-3 rounded-md py-2 pr-2.5"
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
							<span>{item.label}</span>
						</Link>
					);
				});
			})()}
		</div>
	);
}
