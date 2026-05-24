"use client";

/**
 * 地図 view の SSR-safe ラッパ (Phase 12 P12-08b, #817)。
 *
 * Leaflet 本体 (UserMapCanvas) を ``dynamic(..., { ssr:false })`` で読み込む。
 * 空 state / 「結果が多すぎ」 注意 / keyboard 救済の「一覧で見る」 link をここで出す。
 */

import dynamic from "next/dynamic";
import Link from "next/link";

import {
	isPlottableUser,
	type UserSearchResultItem,
} from "@/lib/api/userSearch";

const UserMapCanvas = dynamic(() => import("./UserMapCanvas"), {
	ssr: false,
	loading: () => (
		// role=status + aria-label でロード中を SR に伝える (素の div だと無視されうる、
		// a11y-architect L1)。
		<div
			role="status"
			className="rounded-lg border bg-[color:var(--a-bg-muted)]"
			style={{ borderColor: "var(--a-border)", height: 520 }}
			aria-label="地図を読み込み中"
		/>
	),
});

interface UserMapViewProps {
	results: UserSearchResultItem[];
	/** 検索条件が 1 つでも有るか (無いときは「職業で絞って」 と促す)。 */
	hasQuery: boolean;
	/** 次ページがある = 表示しきれていない (zoom/絞り込み促し)。 */
	hasMore: boolean;
	/** keyboard / SR 救済の list view への戻り link href。 */
	listHref: string;
}

export default function UserMapView({
	results,
	hasQuery,
	hasMore,
	listHref,
}: UserMapViewProps) {
	// canvas (UserMapCanvas) と同じ述語で数える。 residence あり でも座標が不正だと
	// canvas は描かないので、 ここで residence!=null だけ数えると空白地図になりうる
	// (typescript-reviewer HIGH)。
	const plottableCount = results.filter(isPlottableUser).length;

	return (
		<section aria-label="ユーザー地図" className="space-y-2">
			{/* a11y H2/H3: 地図 widget (keyboard/SR には dead-end になりがち) に入る前に、
			    text alternative への導線 (「一覧で見る」) と件数サマリを **canvas より前**
			    に置く。 検索条件が無いとき (= 地図も無い) は逃げ先が無いので row ごと隠す
			    (ui-ux-tester: orphan link 回避)。 count summary だけ role=status を残し、
			    静的な guidance 文は live region にしない (ui-ux-tester / a11y M6)。 */}
			{hasQuery && (
				<div className="flex items-center justify-between gap-3">
					<p role="status" className="text-xs text-[color:var(--a-text-muted)]">
						{plottableCount > 0
							? `${plottableCount} 人を地図に表示しています。一覧で詳細を確認できます。`
							: ""}
					</p>
					<Link
						href={listHref}
						className="shrink-0 py-2 text-xs text-[color:var(--a-accent)] underline underline-offset-2"
					>
						一覧で見る
					</Link>
				</div>
			)}

			{!hasQuery && (
				<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-6 text-sm text-[color:var(--a-text-muted)]">
					職業や名前で絞り込むと、
					居住地を設定したユーザーが地図に表示されます。
				</p>
			)}

			{hasQuery && plottableCount === 0 && (
				<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-6 text-sm text-[color:var(--a-text-muted)]">
					条件に一致するユーザーのうち、
					居住地を地図に設定している人はいませんでした。
				</p>
			)}

			{hasQuery && hasMore && (
				<p
					className="rounded-md border border-[color:var(--a-border)] px-3 py-2 text-xs text-[color:var(--a-text-muted)]"
					style={{ background: "var(--a-bg-muted)" }}
				>
					結果が多いため一部のみ地図に表示しています。
					職業などで絞り込むと精度が上がります。
				</p>
			)}

			{hasQuery && plottableCount > 0 && <UserMapCanvas results={results} />}
		</section>
	);
}
