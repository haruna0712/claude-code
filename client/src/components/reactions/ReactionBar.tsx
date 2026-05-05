"use client";

/**
 * ReactionBar — Facebook-style reaction widget (P2-14 #187, FB-style #381).
 *
 * Trigger button:
 *   - my_kind=null  → 👍 + count (灰色)
 *   - my_kind=K     → 絵文字(K) + count (lime 強調)
 *
 * Operations (#381):
 *   - 単 click / tap (短押し, < LONG_PRESS_MS) → quick toggle:
 *       my_kind=null → like を付ける
 *       my_kind=K    → 取消 (`null` に戻す)
 *     つまり Facebook と同じく、click は **常に like トグル**。別 kind に
 *     変えたい場合は長押しから picker を開く。
 *   - 長押し (>= LONG_PRESS_MS) → picker popup を開く
 *   - picker 内 kind click → 選択して popup close (#379, #187)
 *   - Enter キー → quick toggle (= click)
 *   - Alt+Enter キー → picker 開閉 (キーボード代替, SPEC §6.2)
 *   - Escape / outside click → popup close (#379)
 *
 * 長押し判定:
 *   - pointerdown で setTimeout(LONG_PRESS_MS) を開始、`longPressFiredRef=false`
 *   - timer 満了で `longPressFiredRef=true` + `setOpen(true)`
 *   - pointerup / pointercancel で timer 解除
 *   - 続く click イベントで `longPressFiredRef===true` なら quick toggle を
 *     suppress (= picker open のみ)
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
	type PointerEvent,
} from "react";
import { toast } from "react-toastify";

import {
	REACTION_KINDS,
	REACTION_META,
	type ReactionAggregate,
	type ReactionKind,
	toggleReaction,
} from "@/lib/api/reactions";

interface ReactionBarProps {
	tweetId: number;
	initial?: ReactionAggregate;
}

const EMPTY: ReactionAggregate = { counts: {}, my_kind: null };
const LONG_PRESS_MS = 500;
const QUICK_KIND: ReactionKind = "like";
const DEFAULT_TRIGGER_EMOJI = "👍";

export default function ReactionBar({ tweetId, initial }: ReactionBarProps) {
	const [state, setState] = useState<ReactionAggregate>(initial ?? EMPTY);
	const [open, setOpen] = useState(false);
	const [busyKind, setBusyKind] = useState<ReactionKind | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const longPressFiredRef = useRef(false);

	const total = useMemo(
		() => Object.values(state.counts).reduce((a, b) => a + (b ?? 0), 0),
		[state.counts],
	);
	const myActive = state.my_kind;
	const triggerEmoji = myActive
		? REACTION_META[myActive].emoji
		: DEFAULT_TRIGGER_EMOJI;
	const triggerSrLabel = myActive
		? `${REACTION_META[myActive].label}を取消 (長押しで他のリアクション)`
		: "いいね (長押しで他のリアクション)";

	const handlePick = useCallback(
		async (kind: ReactionKind) => {
			if (busyKind) return;

			// #379: 選択した瞬間に popup を閉じる (X / Slack / Discord 慣習)。
			setOpen(false);

			// Optimistic update
			const previous = state;
			setBusyKind(kind);
			setState((prev) => {
				const next = { ...prev, counts: { ...prev.counts } };
				if (prev.my_kind === kind) {
					next.counts[kind] = Math.max(0, (next.counts[kind] ?? 0) - 1);
					next.my_kind = null;
				} else {
					if (prev.my_kind) {
						next.counts[prev.my_kind] = Math.max(
							0,
							(next.counts[prev.my_kind] ?? 0) - 1,
						);
					}
					next.counts[kind] = (next.counts[kind] ?? 0) + 1;
					next.my_kind = kind;
				}
				return next;
			});

			try {
				const result = await toggleReaction(tweetId, kind);
				setState((prev) => ({ ...prev, my_kind: result.kind }));
			} catch {
				setState(previous);
				toast.error("リアクションを更新できませんでした");
			} finally {
				setBusyKind(null);
			}
		},
		[busyKind, state, tweetId],
	);

	// #381: quick toggle (click / Enter) — FB と同じく click は常に like を
	// トグルする。my_kind が like 以外でも click は「現在のリアクションを取消」
	// になる (handlePick が同じ kind 再押下で取消する仕様)。
	const handleQuickToggle = useCallback(() => {
		if (busyKind) return;
		const kind: ReactionKind = state.my_kind ?? QUICK_KIND;
		// fire-and-forget: handlePick 内で error は toast 化される
		handlePick(kind).catch(() => {});
	}, [busyKind, state.my_kind, handlePick]);

	const clearLongPressTimer = useCallback(() => {
		if (longPressTimerRef.current !== null) {
			clearTimeout(longPressTimerRef.current);
			longPressTimerRef.current = null;
		}
	}, []);

	// #381: pointerdown で 500ms タイマ開始、満了で picker open。
	// pointer event は touch / mouse / pen を統一して扱える。
	const handlePointerDown = useCallback(
		(e: PointerEvent<HTMLButtonElement>) => {
			// 右 click / middle click は無視 (button 0 = main)。
			// jsdom (test) では button が undefined なケースがあるので、
			// 数値で 0 以外のときのみ早期 return する (real browser では常に
			// 数値で初期化される)。
			if (typeof e.button === "number" && e.button !== 0) return;
			longPressFiredRef.current = false;
			clearLongPressTimer();
			longPressTimerRef.current = setTimeout(() => {
				longPressFiredRef.current = true;
				setOpen(true);
				longPressTimerRef.current = null;
			}, LONG_PRESS_MS);
		},
		[clearLongPressTimer],
	);

	const handlePointerUpOrCancel = useCallback(() => {
		clearLongPressTimer();
	}, [clearLongPressTimer]);

	// #381: 長押し満了後の click を suppress。click は pointerup の後に発火する。
	const handleClick = useCallback(() => {
		if (longPressFiredRef.current) {
			longPressFiredRef.current = false;
			return;
		}
		handleQuickToggle();
	}, [handleQuickToggle]);

	const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		if (e.altKey && e.key === "Enter") {
			// SPEC §6.2: Alt+Enter is the keyboard alternative to long-press.
			e.preventDefault();
			setOpen((v) => !v);
		}
		// Enter / Space はブラウザが自動で button.click() を発火する。
	};

	// #379: outside click / Escape で popup を閉じる。
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (containerRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("mousedown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	// unmount 時の timer cleanup
	useEffect(() => {
		return () => {
			clearLongPressTimer();
		};
	}, [clearLongPressTimer]);

	return (
		<div ref={containerRef} className="flex flex-col gap-1">
			<button
				type="button"
				aria-label={triggerSrLabel}
				aria-expanded={open}
				aria-haspopup="true"
				aria-pressed={myActive !== null}
				onClick={handleClick}
				onPointerDown={handlePointerDown}
				onPointerUp={handlePointerUpOrCancel}
				onPointerCancel={handlePointerUpOrCancel}
				onPointerLeave={handlePointerUpOrCancel}
				onKeyDown={onTriggerKeyDown}
				className={`flex min-h-[32px] touch-manipulation select-none items-center gap-1 rounded px-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
					myActive
						? "text-lime-700 dark:text-lime-300"
						: "text-muted-foreground hover:text-foreground"
				}`}
			>
				<span aria-hidden="true">{triggerEmoji}</span>
				<span aria-hidden="true">{total}</span>
				<span className="sr-only">
					(現在の合計 {total} 件、長押しまたは Alt+Enter で他のリアクション)
				</span>
			</button>

			{open && (
				<div
					role="group"
					aria-label="リアクションを選択"
					className="flex flex-wrap gap-1 rounded-md border border-border bg-card p-2 shadow-sm"
				>
					{REACTION_KINDS.map((kind) => {
						const meta = REACTION_META[kind];
						const count = state.counts[kind] ?? 0;
						const isMine = state.my_kind === kind;
						return (
							<button
								key={kind}
								type="button"
								aria-label={`${meta.label} (${count} 件)`}
								aria-pressed={isMine}
								disabled={busyKind !== null}
								onClick={() => handlePick(kind)}
								className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
									isMine
										? "bg-lime-500/20 text-lime-700 dark:text-lime-300"
										: "hover:bg-muted"
								} disabled:opacity-50`}
							>
								<span aria-hidden="true">{meta.emoji}</span>
								<span>{count}</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
