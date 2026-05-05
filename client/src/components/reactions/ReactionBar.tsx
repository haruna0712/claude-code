"use client";

/**
 * ReactionBar — inline reaction picker on each tweet (P2-14 / Issue #187).
 *
 * Behaviour:
 *   - Trigger button: shows "<emoji> <count>" (or "リアクション 0" empty state),
 *     toggles a 10-emoji grid below.
 *   - Click any emoji → optimistic count adjust + POST /tweets/<id>/reactions/
 *     - If picked the same kind currently active → toggles off (X-style)
 *     - If different kind → swap (decrement old, increment new)
 *   - Alt+Enter on the trigger opens the picker (kbd shortcut SPEC §6.2).
 *
 * Dismiss (#379):
 *   - Picking any kind closes the popup (X / Slack / Discord 慣習)
 *   - Outside click closes the popup
 *   - Escape key closes the popup
 *
 * Initial counts come from the GET reactions endpoint via props; Tweet objects
 * don't yet carry reaction counts inline (follow-up: include them in
 * TweetListSerializer to avoid an N+1 fetch on the timeline).
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEvent,
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

export default function ReactionBar({ tweetId, initial }: ReactionBarProps) {
	const [state, setState] = useState<ReactionAggregate>(initial ?? EMPTY);
	const [open, setOpen] = useState(false);
	const [busyKind, setBusyKind] = useState<ReactionKind | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const total = useMemo(
		() => Object.values(state.counts).reduce((a, b) => a + (b ?? 0), 0),
		[state.counts],
	);
	const myActive = state.my_kind;
	const triggerLabel = myActive
		? `${REACTION_META[myActive].emoji} ${total}`
		: `リアクション ${total}`;

	const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
		// SPEC §6.2: Alt+Enter is the keyboard alternative to mouse hover.
		if (e.altKey && e.key === "Enter") {
			e.preventDefault();
			setOpen((v) => !v);
		}
	};

	// #379: outside click / Escape で popup を閉じる。open のときだけ listener を
	// 登録し、cleanup で解除する。capture で document に渡す必要はなく、
	// bubble phase の mousedown / keydown で十分。
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

	const handlePick = useCallback(
		async (kind: ReactionKind) => {
			if (busyKind) return;

			// #379: 選択した瞬間に popup を閉じる (X / Slack / Discord 慣習)。
			// API 結果を待たずに閉じるのは、optimistic update と組で UX を即時化
			// するため。失敗時は state がロールバックされるので popup を閉じても
			// 結果整合性は保たれる。
			setOpen(false);

			// Optimistic update
			const previous = state;
			setBusyKind(kind);
			setState((prev) => {
				const next = { ...prev, counts: { ...prev.counts } };
				if (prev.my_kind === kind) {
					// Toggle off
					next.counts[kind] = Math.max(0, (next.counts[kind] ?? 0) - 1);
					next.my_kind = null;
				} else {
					// Swap: decrement old (if any), increment new
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
				// Reconcile with server: trust server's view of my_kind.
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

	return (
		<div ref={containerRef} className="flex flex-col gap-1">
			<button
				type="button"
				aria-label="リアクション"
				aria-expanded={open}
				aria-haspopup="true"
				onClick={() => setOpen((v) => !v)}
				onKeyDown={onTriggerKeyDown}
				className="flex min-h-[32px] items-center gap-1 rounded px-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<span aria-hidden="true">{triggerLabel}</span>
				<span className="sr-only">
					(Alt+Enter で開閉、現在の合計 {total} 件)
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
