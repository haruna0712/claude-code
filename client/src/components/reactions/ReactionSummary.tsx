"use client";

/**
 * ReactionSummary — tweet 本文の下に表示するリアクションのブレイクダウン (#383, #385).
 *
 * Facebook / Threads / カロッター 等の慣習に倣い、ツイートに付いた reaction を
 * 「kind ごとの内訳」で要約表示する:
 *   ❤️ 4  💡 3  👍 2
 *
 * 仕様: docs/specs/reactions-spec.md §4.3
 *
 * - `summary.counts` を **count desc** (tie は kind の宣言順) で sort し
 *   上位 `MAX_VISIBLE_KINDS` (default 3) を表示する。
 * - `total === 0` のときは何も render しない (= 0 件のときに目立たないように)。
 * - viewer 別の `my_kind` は本 component では区別しない (集計は全 viewer 共通)。
 *   trigger 側 (ReactionBar) が viewer 別の表示を担当する分業。
 * - #385: 末尾の `· N 件` 総計表示は撤去 (FB 慣習に合わせて kind 内訳のみ)。
 */

import {
	REACTION_KINDS,
	REACTION_META,
	type ReactionAggregate,
	type ReactionKind,
} from "@/lib/api/reactions";

interface ReactionSummaryProps {
	summary: ReactionAggregate;
	/** 表示する kind 数の上限 (default 3) */
	maxVisibleKinds?: number;
}

const DEFAULT_MAX_VISIBLE = 3;

/**
 * count desc で sort し、tie は REACTION_KINDS の宣言順で。
 * 0 件の kind は除外する。
 */
function sortKinds(
	counts: Partial<Record<ReactionKind, number>>,
): Array<{ kind: ReactionKind; count: number }> {
	const declarationIndex = new Map<ReactionKind, number>();
	REACTION_KINDS.forEach((k, i) => declarationIndex.set(k, i));
	return REACTION_KINDS.map((kind) => ({ kind, count: counts[kind] ?? 0 }))
		.filter((row) => row.count > 0)
		.sort((a, b) => {
			if (b.count !== a.count) return b.count - a.count;
			return (
				(declarationIndex.get(a.kind) ?? 0) -
				(declarationIndex.get(b.kind) ?? 0)
			);
		});
}

export default function ReactionSummary({
	summary,
	maxVisibleKinds = DEFAULT_MAX_VISIBLE,
}: ReactionSummaryProps) {
	const sorted = sortKinds(summary.counts);
	const total = sorted.reduce((a, b) => a + b.count, 0);
	if (total === 0) return null;

	const visible = sorted.slice(0, maxVisibleKinds);

	return (
		<div
			role="group"
			aria-label="リアクションの内訳"
			className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
		>
			{visible.map(({ kind, count }) => (
				<span
					key={kind}
					className="inline-flex items-center gap-0.5 rounded-full bg-muted/40 px-2 py-0.5"
				>
					<span aria-hidden="true">{REACTION_META[kind].emoji}</span>
					<span className="sr-only">{REACTION_META[kind].label}</span>
					<span>{count}</span>
				</span>
			))}
		</div>
	);
}
