"use client";

/**
 * A direction Compose Shell (#555 Phase B-0-4, refactor #595).
 *
 * home (`/`) でだけ表示する **inline compose 行**:
 *   avatar + 「いま何を作っていますか？」 prompt + IconBtns + char counter (180) +
 *   cyan「ツイート」 button
 *
 * click で `dispatchAComposeOpen()` を呼んで `AComposeDialogHost` 経由で
 * `ComposeTweetDialog` を開く。 dialog state / listener / dialog 本体は本
 * component には居ない (#595 で AComposeDialogHost に切り出した — home 以外でも
 * ALeftNav の「投稿する」 button が動くようにするため、 (template)/layout.tsx 側に
 * host を 1 つ埋めた)。
 */

import { Code, Hash, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { dispatchAComposeOpen } from "@/components/layout-a/AComposeDialogHost";
import { useUserProfile } from "@/hooks/useUseProfile";

export default function AComposeShell() {
	const { profile } = useUserProfile();

	// 未ログイン時は inline compose を出さない (CTA は landing 側で出している)
	if (!profile) return null;

	const initials = (profile.display_name || profile.username)
		.slice(0, 2)
		.toUpperCase();

	return (
		<button
			type="button"
			aria-label="ツイートを投稿する"
			onClick={dispatchAComposeOpen}
			className="flex w-full items-start gap-2.5 border-b px-5 py-3 text-left transition-colors hover:bg-[color:var(--a-bg-subtle)] focus-visible:bg-[color:var(--a-bg-subtle)] focus-visible:outline-none"
			style={{ borderColor: "var(--a-border)" }}
		>
			<div
				className="grid size-8 shrink-0 place-items-center rounded-full font-semibold text-white"
				style={{ background: "hsl(200 70% 32%)", fontSize: 12 }}
				aria-hidden
			>
				{initials}
			</div>
			<div className="flex-1">
				<div
					className="text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 14, padding: "6px 0 8px" }}
				>
					いま何を作っていますか？
				</div>
				<div className="mt-1 flex items-center gap-1.5">
					<IconBtn>
						<Code className="size-3.5" />
					</IconBtn>
					<IconBtn>
						<Hash className="size-3.5" />
					</IconBtn>
					<IconBtn>
						<Sparkles className="size-3.5" />
					</IconBtn>
					<span
						className="ml-auto text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						180
					</span>
					<span
						className="rounded-md px-3 py-1 font-medium text-white"
						style={{
							background: "var(--a-accent)",
							fontSize: 12.5,
							fontFamily: "inherit",
						}}
					>
						ツイート
					</span>
				</div>
			</div>
		</button>
	);
}

function IconBtn({ children }: { children: ReactNode }) {
	return (
		<span
			aria-hidden
			className="inline-flex size-7 items-center justify-center rounded-md text-[color:var(--a-text-muted)]"
		>
			{children}
		</span>
	);
}
