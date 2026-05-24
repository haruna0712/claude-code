"use client";

/**
 * 職業 (occupation) chip filter (Phase 12 P12-07, issue #816)。
 *
 * `/search/users` で職業 slug を toggle して URL に同期する。 選択は
 * ``?occupation=designer&occupation=frontend`` の形で複数 (backend で OR 結合)。
 * 既存の q / near_me / radius_km は維持したまま navigate する。
 *
 * a11y design (OccupationChipPicker と一貫):
 *   - chip は ``role=switch`` + ``aria-checked``。 visible text 自身が
 *     accessible name となるよう ``aria-label`` は付けない。
 *   - 選択 chip は ``--a-accent-deep`` 塗り + ``✓`` icon (色のみ依存を回避)。
 *   - filter 変更は即 URL navigate (保存 button は無い、 検索 filter なので)。
 *   - 1 件以上選択中のとき「すべて解除」 link を出す。
 *   - 見出しは heading 要素にせず、 visible label ``<p id>`` を chips の
 *     ``role=group`` から ``aria-labelledby`` で 1 回だけ参照する (兄弟の
 *     NearMeFilter と同じく page の h1→h2 階層に余計な heading を挿さない、
 *     かつ label 文字列の二重アナウンスを避ける — typescript-reviewer 指摘)。
 */

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import type { Occupation } from "@/lib/api/occupation";
import { buildUserSearchHref } from "@/lib/api/userSearch";

interface OccupationFilterProps {
	/** GET /api/v1/occupations/ の catalog (is_active のみ、 display_order 順)。 */
	occupations: Occupation[];
	/** URL から復元した現在の選択 slug。 */
	selected: string[];
	/** 併存する text query (URL 維持用)。 */
	query: string;
	/** 併存する近所検索 state (URL 維持用)。 */
	nearMe: boolean;
	radiusKm: number;
}

export default function OccupationFilter({
	occupations,
	selected,
	query,
	nearMe,
	radiusKm,
}: OccupationFilterProps) {
	const router = useRouter();

	// toggle / 解除で router.push すると server component が再 render され、
	// keyboard / SR の focus が body に落ちる (a11y-architect H-1)。 直前に操作した
	// chip の slug を覚えておき、 navigation 後 (selected prop が変わった後) に
	// その chip へ focus を戻す。 stable key 由来で DOM が保持される場合は no-op、
	// 落ちた場合の保険。
	const refocusSlugRef = useRef<string | null>(null);

	useEffect(() => {
		const slug = refocusSlugRef.current;
		if (!slug) return;
		refocusSlugRef.current = null;
		document
			.querySelector<HTMLElement>(
				`[data-occupation-chip="${CSS.escape(slug)}"]`,
			)
			?.focus();
	}, [selected]);

	// catalog が取れなかった (SSR fetch 失敗) ときは何も描画しない。
	// q / near 検索は従来通り動くので filter UI だけ消す。
	if (occupations.length === 0) return null;

	const selectedSet = new Set(selected);

	const navigate = (nextOccupations: string[]) => {
		// filter を変えたら cursor は無効になるので引き継がない (1 page 目に戻す)。
		// scroll:false で navigation 時の viewport jump を防ぐ (a11y-architect H-1)。
		router.push(
			buildUserSearchHref({
				q: query,
				nearMe,
				radiusKm,
				occupations: nextOccupations,
			}),
			{ scroll: false },
		);
	};

	const toggle = (slug: string) => {
		refocusSlugRef.current = slug;
		const next = new Set(selectedSet);
		if (next.has(slug)) {
			next.delete(slug);
		} else {
			next.add(slug);
		}
		// catalog の表示順 (display_order) を維持して URL を安定させる。
		navigate(occupations.map((o) => o.slug).filter((s) => next.has(s)));
	};

	const clearAll = () => {
		// 全解除後は「すべて解除」 button が消えるので、 focus を先頭 chip へ逃がす。
		refocusSlugRef.current = occupations[0]?.slug ?? null;
		navigate([]);
	};

	const hasSelection = selectedSet.size > 0;

	return (
		<div
			className="rounded-md border border-[color:var(--a-border)] px-3 py-2"
			style={{ background: "var(--a-bg-muted)" }}
		>
			<div className="mb-2 flex items-baseline justify-between">
				<p
					id="occupation-filter-label"
					className="text-[color:var(--a-text-muted)]"
					style={{ fontSize: 12, fontWeight: 600 }}
				>
					職業で絞り込む
				</p>
				{hasSelection && (
					<button
						type="button"
						onClick={clearAll}
						className="text-[color:var(--a-text-muted)] underline-offset-2 hover:underline"
						style={{ fontSize: 11.5 }}
					>
						すべて解除
					</button>
				)}
			</div>

			<div
				role="group"
				aria-labelledby="occupation-filter-label"
				className="flex flex-wrap gap-2"
			>
				{occupations.map((occ) => {
					const isSelected = selectedSet.has(occ.slug);
					return (
						<button
							key={occ.slug}
							type="button"
							role="switch"
							aria-checked={isSelected}
							onClick={() => toggle(occ.slug)}
							data-occupation-chip={occ.slug}
							className={
								"inline-flex min-h-[28px] items-center gap-1 rounded-full border px-3 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent-deep)] " +
								(isSelected
									? "border-[color:var(--a-accent-deep)] bg-[color:var(--a-accent-deep)] text-white"
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
		</div>
	);
}
