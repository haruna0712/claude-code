"use client";

/**
 * A direction Compose Shell (#555 Phase B-0-4).
 *
 * gan-evaluator Blocker 5 への対応。home-a の inline compose 行を実装し、
 * ALeftNav の「投稿する」 button からも同じ ComposeTweetDialog を起こす wiring。
 *
 * - inline compose 行: avatar + 「いま何を作っていますか？」 prompt + IconBtns +
 *   char counter (180 limit) + cyan「ツイート」 button
 * - click で既存 ComposeTweetDialog (root tweet 投稿) を開く
 * - ALeftNav から `window.dispatchEvent('a-compose-open')` でも開く (左ナビ
 *   「投稿する」 button を /articles/new に飛ばさず本 shell が掴む)
 *
 * 設計: ComposeTweetDialog は元々 dialog の open/close を親が握る方式なので、
 * 本 shell が open state を保有してそれを渡す。
 */

import { Code, Hash, Sparkles } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import ComposeTweetDialog from "@/components/tweets/ComposeTweetDialog";
import { useUserProfile } from "@/hooks/useUseProfile";

const COMPOSE_OPEN_EVENT = "a-compose-open";

/** ALeftNav 等の外部 trigger から呼ぶための window event 名 (export して共有). */
export function dispatchAComposeOpen(): void {
	if (typeof window !== "undefined") {
		window.dispatchEvent(new CustomEvent(COMPOSE_OPEN_EVENT));
	}
}

export default function AComposeShell() {
	const { profile } = useUserProfile();
	const [open, setOpen] = useState(false);

	useEffect(() => {
		const handler = () => setOpen(true);
		window.addEventListener(COMPOSE_OPEN_EVENT, handler);
		return () => window.removeEventListener(COMPOSE_OPEN_EVENT, handler);
	}, []);

	// 未ログイン時は inline compose を出さない (CTA は landing 側で出している)
	if (!profile) return null;

	const initials = (profile.display_name || profile.username)
		.slice(0, 2)
		.toUpperCase();

	return (
		<>
			<button
				type="button"
				aria-label="ツイートを投稿する"
				onClick={() => setOpen(true)}
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
			<ComposeTweetDialog open={open} onOpenChange={setOpen} />
		</>
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
