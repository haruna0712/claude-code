"use client";

/**
 * Occupation chip picker (Phase 12 P12-06b, issue #818).
 *
 * Multi-select chip picker for /settings/profile. Max ``OCCUPATION_MAX_PER_USER``
 * (= 3) chips can be active. After ``保存`` the server replaces the user's
 * occupations with the current selection (PUT semantics).
 *
 * a11y:
 *   - chips are ``role=switch`` with ``aria-checked``
 *   - count indicator uses ``aria-live=polite``
 *   - success toast is shown via ``role=status`` (also polite)
 */

import axios from "axios";
import { useState } from "react";
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
			return next;
		});
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
			// axios error (= サーバ応答あり) は DRF error parser で人間に読める
			// メッセージを取り出す。 client-side early-throw (Error) は
			// 既に日本語メッセージなのでそのまま使う。
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
			<p className="text-sm text-muted-foreground">
				職業 catalog を取得できませんでした。
			</p>
		);
	}

	return (
		<section aria-labelledby="occupation-picker-heading" className="space-y-3">
			<div className="flex items-baseline justify-between">
				<h3
					id="occupation-picker-heading"
					className="text-sm font-semibold tracking-tight"
				>
					職業 (最大 {OCCUPATION_MAX_PER_USER} 件)
				</h3>
				<p
					className="text-xs text-muted-foreground"
					aria-live="polite"
					data-testid="occupation-count"
				>
					{selected.size} / {OCCUPATION_MAX_PER_USER} 件選択中
				</p>
			</div>

			<ul className="flex flex-wrap gap-2" role="group" aria-label="職業を選択">
				{allOccupations.map((occ) => {
					const isSelected = selected.has(occ.slug);
					const isDisabled = !isSelected && reachedMax;
					return (
						<li key={occ.slug}>
							<button
								type="button"
								role="switch"
								aria-checked={isSelected}
								aria-label={occ.display_name}
								disabled={isDisabled}
								onClick={() => toggleSlug(occ.slug)}
								data-slug={occ.slug}
								className={
									"rounded-full border px-3 py-1 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
									(isSelected
										? "border-[color:var(--a-accent)] bg-[color:var(--a-accent)] text-white"
										: isDisabled
											? "cursor-not-allowed border-border text-muted-foreground opacity-50"
											: "border-border bg-background text-foreground hover:bg-muted")
								}
							>
								{occ.display_name}
							</button>
						</li>
					);
				})}
			</ul>

			{reachedMax && (
				<p
					className="text-xs text-muted-foreground"
					data-testid="occupation-limit-hint"
				>
					最大 {OCCUPATION_MAX_PER_USER} 件まで選択できます。
					他を選ぶには既存の選択を外してください。
				</p>
			)}

			{errorMsg && (
				<p role="alert" className="text-sm text-red-600">
					{errorMsg}
				</p>
			)}

			<div>
				<button
					type="button"
					onClick={handleSave}
					disabled={!isDirty || isSaving}
					className="rounded-full bg-[color:var(--a-accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isSaving ? "保存中…" : "職業を保存"}
				</button>
			</div>
		</section>
	);
}
