"use client";

/**
 * Occupation chip picker (Phase 12 P12-06b, issue #818).
 *
 * Multi-select chip picker for /settings/profile. Max ``OCCUPATION_MAX_PER_USER``
 * (= 3) chips can be active. After ``保存`` the server replaces the user's
 * occupations with the current selection (PUT semantics).
 *
 * a11y design:
 *   - chips are ``role=switch`` + ``aria-checked``。 visible text 自身が
 *     accessible name となるよう ``aria-label`` は付けない (重複ラベル回避)。
 *   - 4 件目以降は ``aria-disabled="true"`` (focusable は維持)。 SR 経由で
 *     「ここは disabled で、 なぜ disabled か」 を ``aria-describedby`` で説明。
 *   - 件数 indicator は visible のみ。 max 境界遷移 (3 件到達 / 解除) のときだけ
 *     別 ``role=status`` region で 1 回 polite アナウンス (連続更新の noise を抑制)。
 *   - 限定 hint は ``role=status`` で polite。
 *   - 保存失敗 inline message は ``role=status`` (assertive の `role=alert` は
 *     session 切れ等の中断系に予約)。
 *   - 保存中は ``aria-busy=true`` で SR に「処理中」 を伝える。
 *   - 選択 chip の text 色は AA 4.5:1 を満たす ``--a-accent-deep`` + white、
 *     さらに ``✓`` icon を併記して色のみ依存を回避。
 */

import axios from "axios";
import { useRef, useState } from "react";
import { toast } from "react-toastify";

import { parseDrfErrors } from "@/lib/api/errors";
import {
	OCCUPATION_MAX_PER_USER,
	saveMyOccupations,
	type Occupation,
} from "@/lib/api/occupation";

interface OccupationChipPickerProps {
	allOccupations: Occupation[];
	initialSelectedSlugs: string[];
}

const HINT_ID = "occupation-limit-hint";

export default function OccupationChipPicker({
	allOccupations,
	initialSelectedSlugs,
}: OccupationChipPickerProps) {
	const [selected, setSelected] = useState<Set<string>>(
		() => new Set(initialSelectedSlugs),
	);
	const [savedSlugs, setSavedSlugs] = useState<Set<string>>(
		() => new Set(initialSelectedSlugs),
	);
	const [isSaving, setIsSaving] = useState(false);
	const [errorMsg, setErrorMsg] = useState<string | null>(null);
	// max 境界遷移のときだけ polite に流すアナウンス。 通常の count 更新は visible 表示のみ。
	const [boundaryAnnouncement, setBoundaryAnnouncement] = useState<string>("");
	const prevReachedMaxRef = useRef<boolean>(
		initialSelectedSlugs.length >= OCCUPATION_MAX_PER_USER,
	);

	const reachedMax = selected.size >= OCCUPATION_MAX_PER_USER;
	const isDirty =
		selected.size !== savedSlugs.size ||
		Array.from(selected).some((s) => !savedSlugs.has(s));

	const toggleSlug = (slug: string) => {
		setErrorMsg(null);
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(slug)) {
				next.delete(slug);
			} else if (next.size < OCCUPATION_MAX_PER_USER) {
				next.add(slug);
			}
			// max 境界の遷移 (達した / 解除した) を 1 回だけ polite に流す。
			const nextReached = next.size >= OCCUPATION_MAX_PER_USER;
			if (nextReached !== prevReachedMaxRef.current) {
				setBoundaryAnnouncement(
					nextReached
						? `最大 ${OCCUPATION_MAX_PER_USER} 件選択しました。 これ以上は選択できません。`
						: "最大選択を解除しました。 追加で選択できます。",
				);
				prevReachedMaxRef.current = nextReached;
			}
			return next;
		});
	};

	const handleChipClick = (slug: string, isDisabled: boolean) => {
		// aria-disabled でも DOM の onClick は発火するので明示的に early-return。
		if (isDisabled) return;
		toggleSlug(slug);
	};

	const handleSave = async () => {
		if (!isDirty || isSaving) return;
		setIsSaving(true);
		setErrorMsg(null);
		try {
			const slugs = Array.from(selected);
			const saved = await saveMyOccupations(slugs);
			const nextSaved = new Set(saved);
			setSavedSlugs(nextSaved);
			setSelected(nextSaved);
			toast.success("職業を保存しました");
		} catch (err: unknown) {
			let message = "保存に失敗しました。";
			if (axios.isAxiosError(err)) {
				message = parseDrfErrors(err).summary ?? message;
			} else if (err instanceof Error && err.message) {
				message = err.message;
			}
			setErrorMsg(message);
		} finally {
			setIsSaving(false);
		}
	};

	if (allOccupations.length === 0) {
		return (
			<p className="text-sm text-muted-foreground" role="status">
				職業 catalog を取得できませんでした。
			</p>
		);
	}

	return (
		<section aria-labelledby="occupation-picker-heading" className="space-y-3">
			<div className="flex items-baseline justify-between">
				<h2
					id="occupation-picker-heading"
					className="text-sm font-semibold tracking-tight"
				>
					職業 (最大 {OCCUPATION_MAX_PER_USER} 件)
				</h2>
				<p
					className="text-xs text-muted-foreground"
					data-testid="occupation-count"
				>
					{selected.size} / {OCCUPATION_MAX_PER_USER} 件選択中
				</p>
			</div>

			{/* 閾値アナウンス用 polite live region。 通常 count 変更では更新せず、
			    max 境界をまたいだ瞬間だけ 1 回だけ message を入れる (SR noise 抑制)。 */}
			<p role="status" className="sr-only">
				{boundaryAnnouncement}
			</p>

			<div
				role="group"
				aria-label="職業を選択"
				className="flex flex-wrap gap-2"
			>
				{allOccupations.map((occ) => {
					const isSelected = selected.has(occ.slug);
					const isDisabled = !isSelected && reachedMax;
					return (
						<button
							key={occ.slug}
							type="button"
							role="switch"
							aria-checked={isSelected}
							aria-disabled={isDisabled || undefined}
							aria-describedby={isDisabled ? HINT_ID : undefined}
							onClick={() => handleChipClick(occ.slug, isDisabled)}
							data-slug={occ.slug}
							className={
								"inline-flex min-h-[28px] items-center gap-1 rounded-full border px-3 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent-deep)] " +
								(isSelected
									? "border-[color:var(--a-accent-deep)] bg-[color:var(--a-accent-deep)] text-white"
									: isDisabled
										? "cursor-not-allowed border-border text-muted-foreground opacity-50"
										: "border-border bg-background text-foreground hover:bg-muted")
							}
						>
							{isSelected && (
								<span aria-hidden="true" className="text-xs leading-none">
									✓
								</span>
							)}
							{occ.display_name}
						</button>
					);
				})}
			</div>

			{reachedMax && (
				<p
					id={HINT_ID}
					role="status"
					className="text-xs text-muted-foreground"
					data-testid="occupation-limit-hint"
				>
					最大 {OCCUPATION_MAX_PER_USER} 件まで選択できます。
					他を選ぶには既存の選択を外してください。
				</p>
			)}

			{errorMsg && (
				<p role="status" className="text-sm text-red-600">
					{errorMsg}
				</p>
			)}

			<div>
				<button
					type="button"
					onClick={handleSave}
					disabled={!isDirty || isSaving}
					aria-busy={isSaving || undefined}
					className="rounded-full bg-[color:var(--a-accent-deep)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent-deep)] disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSaving ? "保存中…" : "職業を保存"}
				</button>
			</div>
		</section>
	);
}
