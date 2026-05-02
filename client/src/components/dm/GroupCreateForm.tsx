"use client";

/**
 * グループ作成フォーム (P3-11 / Issue #236).
 *
 * SPEC §7.1 / §7.2 のグループ作成 UI。zod でクライアント検証し、
 * `POST /api/v1/dm/rooms/` を叩いて成功時は `/messages/<id>` に遷移する。
 *
 * scope:
 * - 名前 1-50 字
 * - 招待メンバーは @handle を改行 / カンマ区切りで入力 (incremental search はフォローアップ)
 * - creator + 19 名 = 20 名上限 (server side validation と整合)
 * - icon upload は Phase 3 範囲外 (auto-color initials を採用、別 issue)
 *
 * a11y:
 * - 各 input に <label>
 * - error は role=alert + aria-describedby
 */

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";

import { useCreateDMRoomMutation } from "@/lib/redux/features/dm/dmApiSlice";

/**
 * RTK Query mutation の throw は `FetchBaseQueryError | SerializedError | Error` のいずれか。
 * UI に最適な message を抽出する (code-reviewer MEDIUM M-4 反映)。
 */
function extractErrorMessage(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as Record<string, unknown>;
		// FetchBaseQueryError: { status, data }
		if (
			typeof e.status !== "undefined" &&
			e.data &&
			typeof e.data === "object"
		) {
			const d = e.data as Record<string, unknown>;
			if (typeof d.detail === "string") return d.detail;
			if (
				Array.isArray(d.non_field_errors) &&
				typeof d.non_field_errors[0] === "string"
			) {
				return d.non_field_errors[0];
			}
		}
		if (typeof e.message === "string") return e.message;
	}
	if (err instanceof Error) return err.message;
	return fallback;
}

const HANDLE_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

interface GroupCreateFormProps {
	onCreated?(roomId: number): void;
	onCancel?(): void;
}

export default function GroupCreateForm({
	onCreated,
	onCancel,
}: GroupCreateFormProps) {
	const router = useRouter();
	const [createRoom, { isLoading }] = useCreateDMRoomMutation();

	const [name, setName] = useState("");
	const [handlesRaw, setHandlesRaw] = useState("");
	const [errors, setErrors] = useState<{
		name?: string;
		handles?: string;
		general?: string;
	}>({});
	const nameRef = useRef<HTMLInputElement | null>(null);
	const handlesRef = useRef<HTMLTextAreaElement | null>(null);

	const parsedHandles = handlesRaw
		.split(/[\n,\s]+/)
		.map((s) => s.trim().replace(/^@/, ""))
		.filter((s) => s.length > 0);

	const validate = (): boolean => {
		const next: typeof errors = {};
		const trimmedName = name.trim();
		if (trimmedName.length === 0) next.name = "グループ名は必須です";
		else if (trimmedName.length > 50)
			next.name = "グループ名は 50 字以内で入力してください";

		if (parsedHandles.length === 0) {
			next.handles = "1 名以上の招待メンバーが必要です";
		} else if (parsedHandles.length > 19) {
			next.handles = `招待は最大 19 名 (creator 含む 20 名) です (現在 ${parsedHandles.length} 名)`;
		} else {
			const invalid = parsedHandles.filter((h) => !HANDLE_REGEX.test(h));
			if (invalid.length > 0) {
				next.handles = `不正な handle: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? " ..." : ""}`;
			}
		}

		setErrors(next);
		// a11y H3: 最初のエラー入力欄へ focus を戻す (DOM 順)
		if (next.name) nameRef.current?.focus();
		else if (next.handles) handlesRef.current?.focus();
		return Object.keys(next).length === 0;
	};

	const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!validate()) return;
		try {
			const room = await createRoom({
				kind: "group",
				name: name.trim(),
				invitee_handles: parsedHandles,
			}).unwrap();
			if (onCreated) onCreated(room.id);
			else router.push(`/messages/${room.id}`);
		} catch (err: unknown) {
			setErrors({
				general: extractErrorMessage(err, "グループの作成に失敗しました"),
			});
		}
	};

	const submitDisabled =
		isLoading || name.trim().length === 0 || parsedHandles.length === 0;

	return (
		<form
			onSubmit={onSubmit}
			className="flex flex-col gap-4"
			aria-label="グループ作成"
			aria-busy={isLoading}
		>
			{errors.general ? (
				<div role="alert" className="text-baby_red text-sm">
					{errors.general}
				</div>
			) : null}
			<div className="flex flex-col gap-1">
				<label
					htmlFor="group-name"
					className="text-baby_white text-sm font-semibold"
				>
					グループ名
				</label>
				<input
					ref={nameRef}
					id="group-name"
					type="text"
					value={name}
					onChange={(e) => setName(e.target.value)}
					maxLength={50}
					required
					aria-invalid={Boolean(errors.name)}
					aria-describedby={errors.name ? "group-name-error" : undefined}
					className="bg-baby_veryBlack text-baby_white focus-visible:ring-baby_blue rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
				/>
				{errors.name ? (
					<p
						id="group-name-error"
						role="alert"
						className="text-baby_red text-xs"
					>
						{errors.name}
					</p>
				) : null}
			</div>
			<div className="flex flex-col gap-1">
				<label
					htmlFor="group-handles"
					className="text-baby_white text-sm font-semibold"
				>
					招待メンバー (@handle、改行 / スペース / カンマ区切り)
				</label>
				<textarea
					ref={handlesRef}
					id="group-handles"
					value={handlesRaw}
					onChange={(e) => setHandlesRaw(e.target.value)}
					rows={3}
					required
					aria-invalid={Boolean(errors.handles)}
					aria-describedby={
						errors.handles
							? "group-handles-hint group-handles-error"
							: "group-handles-hint"
					}
					className="bg-baby_veryBlack text-baby_white focus-visible:ring-baby_blue rounded-md px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
				/>
				<p id="group-handles-hint" className="text-baby_grey text-xs">
					選択中: {parsedHandles.length} 名 (上限 19 名)
				</p>
				{errors.handles ? (
					<p
						id="group-handles-error"
						role="alert"
						className="text-baby_red text-xs"
					>
						{errors.handles}
					</p>
				) : null}
			</div>
			<div className="flex justify-end gap-2">
				{onCancel ? (
					<button
						type="button"
						onClick={onCancel}
						className="border-baby_grey text-baby_grey hover:bg-baby_grey/10 focus-visible:ring-baby_blue rounded-md border px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
					>
						キャンセル
					</button>
				) : null}
				<button
					type="submit"
					disabled={submitDisabled}
					aria-busy={isLoading}
					className="bg-baby_blue text-baby_white focus-visible:ring-baby_white rounded-md px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50"
				>
					{isLoading ? "作成中..." : "グループを作成"}
				</button>
			</div>
		</form>
	);
}
