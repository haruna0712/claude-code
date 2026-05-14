"use client";

/**
 * /settings/* 全 page 共通の sticky sub-nav (Phase 12 follow-up #687)。
 *
 * gan-evaluator CRITICAL: home → 設定 → 居住地マップ 等への 3 click 動線が
 * 無かった (#546 / #687 で再発)。 5 つの settings ルートを横断できる tab bar を
 * `settings/layout.tsx` に挟むことで解消。
 *
 * - sticky top-0 で常時表示
 * - mobile では横スクロール (overflow-x-auto + whitespace-nowrap)
 * - `resolveActiveHref` で sibling sub-route 二重 active を回避 (#685)
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
	Ban,
	Bell,
	MapPin,
	User,
	VolumeX,
	type LucideIcon,
} from "lucide-react";

import { resolveActiveHref } from "@/lib/nav-active";

interface SettingsTab {
	href: string;
	label: string;
	Icon: LucideIcon;
}

const TABS: SettingsTab[] = [
	{ href: "/settings/profile", label: "プロフィール", Icon: User },
	{ href: "/settings/residence", label: "居住地マップ", Icon: MapPin },
	{ href: "/settings/notifications", label: "通知", Icon: Bell },
	{ href: "/settings/blocks", label: "ブロック", Icon: Ban },
	{ href: "/settings/mutes", label: "ミュート", Icon: VolumeX },
];

export default function SettingsTabs() {
	const pathname = usePathname();
	const activeHref = resolveActiveHref(TABS, pathname);

	return (
		<nav
			aria-label="設定 サブナビゲーション"
			className="sticky top-0 z-20 flex gap-1 overflow-x-auto whitespace-nowrap px-3 py-2"
			style={{
				borderBottom: "1px solid var(--a-border)",
				background: "rgba(255,255,255,0.92)",
				backdropFilter: "blur(8px)",
			}}
		>
			{TABS.map((tab) => {
				const isActive = tab.href === activeHref;
				return (
					<Link
						key={tab.href}
						href={tab.href}
						aria-current={isActive ? "page" : undefined}
						className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)] ${
							isActive
								? "bg-[color:var(--a-bg-muted)] font-semibold text-[color:var(--a-text)]"
								: "text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-muted)]"
						}`}
					>
						<tab.Icon className="size-4" aria-hidden="true" />
						<span>{tab.label}</span>
					</Link>
				);
			})}
		</nav>
	);
}
