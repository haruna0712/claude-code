"use client";

/**
 * ModerationListClient (Phase 4B / Issue #450).
 *
 * /settings/blocks と /settings/mutes 共通の一覧 + 解除 UI。
 * - mode="blocks" / "mutes" で API 切替
 * - 各行: avatar / display_name / @handle / 解除ボタン
 * - 楽観的削除 (UI から行を即時消去 → API 失敗時は alert + 復元)
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
	type BlockEntry,
	type MuteEntry,
	listBlocks,
	listMutes,
	unblockUser,
	unmuteUser,
} from "@/lib/api/moderation";

type Mode = "blocks" | "mutes";

interface Props {
	mode: Mode;
}

interface Row {
	handle: string;
	display_name: string;
	avatar_url: string;
}

const LABELS: Record<Mode, { title: string; empty: string; remove: string }> = {
	blocks: {
		title: "ブロック中のユーザー",
		empty: "ブロック中のユーザーはいません。",
		remove: "ブロック解除",
	},
	mutes: {
		title: "ミュート中のユーザー",
		empty: "ミュート中のユーザーはいません。",
		remove: "ミュート解除",
	},
};

function rowFromBlock(b: BlockEntry): Row {
	return {
		handle: b.blockee_handle,
		display_name: b.blockee.display_name || b.blockee_handle,
		avatar_url: b.blockee.avatar_url,
	};
}

function rowFromMute(m: MuteEntry): Row {
	return {
		handle: m.mutee_handle,
		display_name: m.mutee.display_name || m.mutee_handle,
		avatar_url: m.mutee.avatar_url,
	};
}

export default function ModerationListClient({ mode }: Props) {
	const labels = LABELS[mode];
	const [rows, setRows] = useState<Row[] | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			try {
				if (mode === "blocks") {
					const page = await listBlocks();
					setRows(page.results.map(rowFromBlock));
				} else {
					const page = await listMutes();
					setRows(page.results.map(rowFromMute));
				}
			} catch {
				setRows([]);
			} finally {
				setLoading(false);
			}
		})();
	}, [mode]);

	const onRemove = async (handle: string) => {
		const prev = rows ?? [];
		// 楽観的削除
		setRows(prev.filter((r) => r.handle !== handle));
		try {
			if (mode === "blocks") await unblockUser(handle);
			else await unmuteUser(handle);
		} catch {
			window.alert("解除に失敗しました。");
			setRows(prev);
		}
	};

	return (
		<section aria-label={labels.title}>
			{/* #577: page wrapper の sticky <h1> が page heading なので、
			    ModerationListClient 内部は <h2> + section に降格 (1 page 1 h1)。
			    また外側 <main> は (template)/layout の <main> と二重ネストするため
			    <section> に変更。 */}
			<h2 className="mb-4 text-xl font-bold text-[color:var(--a-text)]">
				{labels.title}
			</h2>
			{loading ? (
				<p className="text-sm text-muted-foreground">読み込み中…</p>
			) : !rows || rows.length === 0 ? (
				<p className="text-sm text-muted-foreground">{labels.empty}</p>
			) : (
				<ul
					role="list"
					className="divide-y divide-border rounded-lg border border-border"
				>
					{rows.map((r) => (
						<li
							key={r.handle}
							className="flex items-center justify-between gap-3 px-4 py-3"
						>
							<Link
								href={`/u/${r.handle}`}
								className="flex min-w-0 items-center gap-3 hover:underline"
							>
								{r.avatar_url ? (
									<Image
										src={r.avatar_url}
										alt=""
										width={40}
										height={40}
										unoptimized
										className="size-10 rounded-full object-cover"
									/>
								) : (
									<span className="flex size-10 items-center justify-center rounded-full bg-muted text-sm">
										{r.handle.slice(0, 1).toUpperCase()}
									</span>
								)}
								<span className="min-w-0">
									<span className="block truncate font-medium">
										{r.display_name}
									</span>
									<span className="block truncate text-xs text-muted-foreground">
										@{r.handle}
									</span>
								</span>
							</Link>
							<button
								type="button"
								onClick={() => onRemove(r.handle)}
								className="shrink-0 rounded border border-border px-3 py-1.5 text-sm hover:bg-muted"
							>
								{labels.remove}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
