"use client";

/**
 * SettingsMenu (#406).
 *
 * LeftNavbar 配下に置く「設定」 dropdown。テーマ切替 (Light/Dark/System) と
 * ログアウトを集約する。Navbar の右上から ThemeSwitcher / AuthAvatar を撤去
 * したのに伴い、ユーザがテーマを切り替える唯一の動線になる。
 */

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Ban,
	Bell,
	LogOut,
	Monitor,
	Moon,
	Settings,
	Sun,
	VolumeX,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import type { ReactElement } from "react";

interface SettingsMenuProps {
	onLogout?: () => void;
	/** lg+ ではボタンに「設定」ラベルを出す。lg 未満は icon のみ。 */
	collapsed?: boolean;
}

const THEMES: Array<{
	value: "light" | "dark" | "system";
	label: string;
	icon: ReactElement;
}> = [
	{
		value: "light",
		label: "ライト",
		icon: <Sun className="size-4" aria-hidden="true" />,
	},
	{
		value: "dark",
		label: "ダーク",
		icon: <Moon className="size-4" aria-hidden="true" />,
	},
	{
		value: "system",
		label: "システム",
		icon: <Monitor className="size-4" aria-hidden="true" />,
	},
];

export default function SettingsMenu({
	onLogout,
	collapsed = false,
}: SettingsMenuProps): ReactElement {
	const { theme, setTheme } = useTheme();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					aria-label="設定"
					className="lime-gradient small-medium light-border-2 btn-tertiary text-baby_ballon flex min-h-[41px] w-full items-center justify-center gap-2 rounded-lg border px-4 py-3 shadow-none"
				>
					<Settings className="size-5 shrink-0" aria-hidden="true" />
					{collapsed ? null : <span>設定</span>}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" side="top" className="w-56">
				<DropdownMenuLabel>テーマ</DropdownMenuLabel>
				{THEMES.map(({ value, label, icon }) => (
					<DropdownMenuItem
						key={value}
						onClick={() => setTheme(value)}
						className={`cursor-pointer gap-2 ${theme === value ? "font-semibold" : ""}`}
					>
						{icon}
						<span>{label}</span>
						{theme === value ? (
							<span className="ml-auto text-xs text-muted-foreground">
								選択中
							</span>
						) : null}
					</DropdownMenuItem>
				))}
				{/* #415: 通知設定へのリンクを設定メニューに追加 */}
				<DropdownMenuSeparator />
				<DropdownMenuItem asChild className="cursor-pointer gap-2">
					<Link
						href="/settings/notifications"
						className="flex items-center gap-2"
					>
						<Bell className="size-4" aria-hidden="true" />
						<span>通知の設定</span>
					</Link>
				</DropdownMenuItem>
				{/* Phase 4B (#450): ブロック / ミュート 一覧 */}
				<DropdownMenuItem asChild className="cursor-pointer gap-2">
					<Link href="/settings/blocks" className="flex items-center gap-2">
						<Ban className="size-4" aria-hidden="true" />
						<span>ブロック中のユーザー</span>
					</Link>
				</DropdownMenuItem>
				<DropdownMenuItem asChild className="cursor-pointer gap-2">
					<Link href="/settings/mutes" className="flex items-center gap-2">
						<VolumeX className="size-4" aria-hidden="true" />
						<span>ミュート中のユーザー</span>
					</Link>
				</DropdownMenuItem>
				{onLogout ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							onClick={onLogout}
							className="cursor-pointer gap-2 text-destructive focus:text-destructive"
						>
							<LogOut className="size-4" aria-hidden="true" />
							<span>ログアウト</span>
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
