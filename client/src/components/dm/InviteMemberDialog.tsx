"use client";

/**
 * グループ room 内から招待を送る Dialog (#476 / #480 で autocomplete 追加).
 *
 * SPEC §7.2 / docs/specs/dm-room-invite-spec.md。
 *
 * - @handle 1 名を入力 → POST /api/v1/dm/rooms/<id>/invitations/
 * - 入力中は GET /api/v1/users/?q=... (debounce 250ms) で前方一致 dropdown
 * - 成功時は role=status で通知 → ~1.2s 後 onOpenChange(false)
 * - 失敗時は role=alert (404 / 409 / 429 / 403 / その他)
 * - クライアント側 validation: 空 / 不正文字 / 空白
 * - a11y: ESC / × button / overlay click で close (Radix デフォルト)、
 *   combobox + listbox + 矢印 / Enter キー操作
 */

import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent,
} from "react";

import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useCreateRoomInvitationMutation } from "@/lib/redux/features/dm/dmApiSlice";
import { useSearchUsersQuery } from "@/lib/redux/features/users/usersApiSlice";

function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(t);
	}, [value, delayMs]);
	return debounced;
}

const HANDLE_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

interface InviteMemberDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	roomId: number;
}

function mapApiError(err: unknown, handle: string): string {
	if (err && typeof err === "object") {
		const e = err as { status?: number | string; data?: unknown };
		const status = typeof e.status === "number" ? e.status : Number(e.status);
		const data =
			e.data && typeof e.data === "object"
				? (e.data as Record<string, unknown>)
				: {};
		const detail = typeof data.detail === "string" ? data.detail : undefined;
		if (status === 404) return `@${handle} というユーザーは見つかりません`;
		if (status === 409) {
			if (detail === "already_member") return `@${handle} は既にメンバーです`;
			if (detail === "pending_invitation")
				return `@${handle} は既に招待済みです`;
			return `@${handle} は既にメンバー / 招待済みです`;
		}
		if (status === 403) return "招待権限がありません (creator のみ可能)";
		if (status === 429) return "招待の上限 (50 件/日) に達しました";
		if (status === 400 && detail) return detail;
	}
	return "招待の送信に失敗しました";
}

export default function InviteMemberDialog({
	open,
	onOpenChange,
	roomId,
}: InviteMemberDialogProps) {
	const [createInvite, { isLoading }] = useCreateRoomInvitationMutation();
	const [handle, setHandle] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [successMsg, setSuccessMsg] = useState<string | null>(null);
	const [activeIdx, setActiveIdx] = useState(-1); // -1 = 何も選択していない (plain input)
	const [showSuggestions, setShowSuggestions] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Issue #480: 検索クエリ (handle の `@` を取り除いた前方一致用)
	const normalizedQuery = useMemo(
		() => handle.trim().replace(/^@/, ""),
		[handle],
	);
	const debouncedQuery = useDebounced(normalizedQuery, 250);
	// 2 文字以上 + suggestions visible なときだけ fetch (skip で query 抑制)
	const { data: searchData } = useSearchUsersQuery(
		{ q: debouncedQuery, limit: 10 },
		{ skip: !showSuggestions || debouncedQuery.length < 2 },
	);
	const suggestions = searchData?.results ?? [];

	// open に切り替わったら state リセット (前回の error / success を消す)
	useEffect(() => {
		if (open) {
			setError(null);
			setSuccessMsg(null);
			setHandle("");
			setActiveIdx(-1);
			setShowSuggestions(false);
		}
	}, [open]);

	// 成功表示後 1.2s で自動 close
	useEffect(() => {
		if (!successMsg) return;
		const t = setTimeout(() => onOpenChange(false), 1200);
		return () => clearTimeout(t);
	}, [successMsg, onOpenChange]);

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setError(null);
		setSuccessMsg(null);
		const normalized = handle.trim().replace(/^@/, "");
		if (normalized.length === 0) {
			setError("@handle を入力してください");
			inputRef.current?.focus();
			return;
		}
		if (!HANDLE_REGEX.test(normalized)) {
			setError(
				"@handle に使用できない文字が含まれています (英数字とアンダースコア 3-30 字)",
			);
			inputRef.current?.focus();
			return;
		}
		try {
			await createInvite({ roomId, invitee_handle: normalized }).unwrap();
			setSuccessMsg(`@${normalized} に招待を送信しました`);
			setShowSuggestions(false);
		} catch (err: unknown) {
			setError(mapApiError(err, normalized));
		}
	};

	const pickSuggestion = (username: string) => {
		setHandle(username);
		setActiveIdx(-1);
		setShowSuggestions(false);
		inputRef.current?.focus();
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (!showSuggestions || suggestions.length === 0) return;
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIdx((i) => (i + 1) % suggestions.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
		} else if (e.key === "Enter" && activeIdx >= 0) {
			e.preventDefault();
			pickSuggestion(suggestions[activeIdx].username);
		} else if (e.key === "Escape") {
			setShowSuggestions(false);
			setActiveIdx(-1);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>このグループに招待</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={onSubmit}
					className="flex flex-col gap-4"
					aria-busy={isLoading}
				>
					{error ? (
						<div role="alert" className="text-baby_red text-sm">
							{error}
						</div>
					) : null}
					{successMsg ? (
						<div
							role="status"
							aria-live="polite"
							className="text-baby_green text-sm"
						>
							{successMsg}
						</div>
					) : null}
					<div className="relative flex flex-col gap-1">
						<label
							htmlFor="invite-handle"
							className="text-baby_white text-sm font-semibold"
						>
							招待するユーザーの @handle
						</label>
						<input
							ref={inputRef}
							id="invite-handle"
							type="text"
							value={handle}
							onChange={(e) => {
								setHandle(e.target.value);
								setShowSuggestions(true);
								setActiveIdx(-1);
							}}
							onFocus={() => setShowSuggestions(true)}
							onBlur={() =>
								// suggestion click が blur 後に来てしまうので 100ms 遅延
								setTimeout(() => setShowSuggestions(false), 100)
							}
							onKeyDown={onKeyDown}
							placeholder="alice"
							autoFocus
							role="combobox"
							aria-autocomplete="list"
							aria-expanded={showSuggestions && suggestions.length > 0}
							aria-controls="invite-suggestions-list"
							aria-activedescendant={
								activeIdx >= 0 ? `invite-suggest-${activeIdx}` : undefined
							}
							aria-invalid={Boolean(error)}
							aria-describedby={error ? "invite-handle-error" : undefined}
							className="bg-baby_veryBlack text-baby_white focus-visible:ring-baby_blue rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
						/>
						{showSuggestions && suggestions.length > 0 ? (
							<ul
								id="invite-suggestions-list"
								role="listbox"
								aria-label="ユーザー候補"
								className="bg-baby_veryBlack border-baby_grey/30 absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-md border shadow-lg"
							>
								{suggestions.map((u, i) => (
									<li
										key={u.user_id}
										id={`invite-suggest-${i}`}
										role="option"
										aria-selected={i === activeIdx}
										onMouseDown={(e) => {
											e.preventDefault(); // blur を防いで click 可能に
											pickSuggestion(u.username);
										}}
										className={`text-baby_white flex cursor-pointer flex-col px-3 py-2 text-sm ${
											i === activeIdx
												? "bg-baby_blue/30"
												: "hover:bg-baby_grey/10"
										}`}
									>
										<span className="font-semibold">@{u.username}</span>
										{u.first_name || u.last_name ? (
											<span className="text-baby_grey text-xs">
												{u.first_name} {u.last_name}
											</span>
										) : null}
									</li>
								))}
							</ul>
						) : null}
						<p className="text-baby_grey text-xs">
							例: alice (英数字とアンダースコア 3-30 字、@ プレフィックス可)。2
							文字以上で候補表示。
						</p>
					</div>
					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="border-baby_grey text-baby_grey hover:bg-baby_grey/10 focus-visible:ring-baby_blue rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
						>
							キャンセル
						</button>
						<button
							type="submit"
							disabled={isLoading || successMsg !== null}
							aria-busy={isLoading}
							className="bg-baby_blue text-baby_white focus-visible:ring-baby_white rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
						>
							{isLoading ? "送信中..." : "招待を送る"}
						</button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
