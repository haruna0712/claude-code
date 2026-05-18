"use client";

/**
 * 保留中の招待を `/messages` ページ上部に inline 表示する disclosure (#792).
 *
 * 旧実装は `/messages` ヘッダー右の 「招待」 link → 専用 `/messages/invitations`
 * route に飛ばしていた。 X / Instagram / LINE / Messenger 等の SNS 慣習に揃え、
 * `RoomList` の上に折りたたみ section を 1 枚挟む方式に変更。 既存
 * `InvitationList` component を panel 内 inline で流用する。
 *
 * 振る舞い:
 *   - pendingCount === 0 / loading 中 → null を返し、 section ごと非表示
 *   - pendingCount > 0 → button + 折りたたみ panel。 button click で展開
 *   - 展開状態は session 内 state (URL / storage に persist しない)
 *
 * a11y:
 *   - section に `role="region"` + `aria-labelledby`
 *   - button に `aria-expanded` / `aria-controls`
 *   - panel は展開時のみ DOM に出る (`aria-controls` の id を一致させる)
 */

import { useId, useState, type JSX } from "react";

import InvitationList from "@/components/dm/InvitationList";
import { useListInvitationsQuery } from "@/lib/redux/features/dm/dmApiSlice";

export default function PendingInvitationsSection(): JSX.Element | null {
	// 注: InvitationList も同じ query を独立 subscribe する。 RTK Query は
	// 同 key の request を deduplicate する + invalidatesTags で accept/decline
	// 後に両 subscriber が同 tick で refetch するため stale 表示は短時間で解消する。
	// 最後の 1 件を accept したときに section が先に null を返して visual flash
	// する可能性があるが、 fixture 上は問題にならない (typescript-reviewer 注)。
	//
	// count は DRF pagination の total。 results は first page (default page size
	// 10) のみ。 保留中招待は数件しか出ない設計 (per-user 同時招待は実運用で
	// 1-5 件が殆ど) なので button "N 件" と panel の row 数は実質一致する。
	// pagination が必要になるレベルの招待数が出る surface ではない
	// (code-reviewer MEDIUM 注)。
	const { data, isLoading } = useListInvitationsQuery({ status: "pending" });
	const [open, setOpen] = useState(false);

	const headingId = useId();
	const panelId = useId();

	const count = data?.count ?? 0;
	if (isLoading || count === 0) return null;

	return (
		<section
			role="region"
			aria-labelledby={headingId}
			className="mb-3 overflow-hidden rounded-md border border-[color:var(--a-border)]"
		>
			{/* a11y: count の動的更新を SR に伝える polite live region (sr-only)。
			    button text 内の aria-live は SR 実装差があるので別 elem に分離
			    (a11y-architect HIGH 反映、 SC 4.1.3 Status Messages)。 button 自身は
			    accessible name = visible text を持つので別 announce で重複しても害なし。 */}
			<span role="status" aria-live="polite" className="sr-only">
				保留中の招待 {count} 件
			</span>
			<button
				id={headingId}
				type="button"
				onClick={() => setOpen((v) => !v)}
				aria-expanded={open}
				aria-controls={panelId}
				className="flex w-full items-center justify-between bg-[color:var(--a-bg-subtle)] px-4 py-3 text-left text-sm font-medium hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
			>
				<span>保留中の招待 {count} 件</span>
				<span aria-hidden="true">{open ? "▾" : "▸"}</span>
			</button>
			{/* panel は常に DOM 配置し、 visibility を `hidden` で切り替える。
			    `aria-controls` の id が常に有効になり ARIA 仕様に準拠する
			    (typescript-reviewer MEDIUM 反映)。 closed 時は `InvitationList` も
			    mount 状態だが、 RTK Query の共有 cache を読むだけなので追加コストはない。 */}
			<div
				id={panelId}
				hidden={!open}
				className="border-t border-[color:var(--a-border)] px-4 py-3"
			>
				<InvitationList />
			</div>
		</section>
	);
}
