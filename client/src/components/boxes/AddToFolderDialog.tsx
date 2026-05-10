"use client";

/**
 * AddToFolderDialog (#499) — TweetCard の bookmark icon を押したとき開く Dialog.
 *
 * docs/specs/favorites-spec.md §5.3 に従う Google ブックマーク Quick Add 風 UX。
 *
 * - 自分の folder 一覧をフラットで表示 (parent でインデント)
 * - 既に保存済の folder は checkbox 状態で表示、クリックで toggle (POST/DELETE)
 * - 新規 folder 作成: name 入力 → POST /folders/ → 即時 list に追加
 * - 失敗時は role=alert で通知
 */

import { useEffect, useState, type FormEvent } from "react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	createBookmark,
	createFolder,
	deleteBookmark,
	getTweetBookmarkStatus,
	listFolders,
	type Folder,
} from "@/lib/api/boxes";

interface AddToFolderDialogProps {
	tweetId: number | string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** 保存状態が変わった (folder_ids 配列) ことを親に通知。bookmark icon 切替に使う。 */
	onStatusChanged?: (folderIds: number[]) => void;
}

interface FolderRowState {
	folder: Folder;
	depth: number;
	isSaved: boolean;
	bookmarkId: number | null;
	isBusy: boolean;
}

function buildOrderedRows(folders: Folder[]): Array<{
	folder: Folder;
	depth: number;
}> {
	// parent_id でグルーピングして DFS で flatten。深さでインデント。
	const byParent = new Map<number | null, Folder[]>();
	for (const f of folders) {
		const key = f.parent_id ?? null;
		const list = byParent.get(key);
		if (list) list.push(f);
		else byParent.set(key, [f]);
	}
	for (const list of Array.from(byParent.values())) {
		list.sort((a: Folder, b: Folder) => a.name.localeCompare(b.name, "ja"));
	}
	const rows: Array<{ folder: Folder; depth: number }> = [];
	const visit = (parentId: number | null, depth: number) => {
		for (const f of byParent.get(parentId) ?? []) {
			rows.push({ folder: f, depth });
			visit(f.id, depth + 1);
		}
	};
	visit(null, 0);
	return rows;
}

function describeApiError(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { data?: Record<string, unknown> };
			message?: string;
		};
		const data = e.response?.data;
		if (data && typeof data === "object") {
			const detail = (data as { detail?: string }).detail;
			if (typeof detail === "string") return detail;
			const firstField = Object.values(data)[0];
			if (Array.isArray(firstField) && typeof firstField[0] === "string") {
				return firstField[0];
			}
			if (typeof firstField === "string") return firstField;
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function AddToFolderDialog({
	tweetId,
	open,
	onOpenChange,
	onStatusChanged,
}: AddToFolderDialogProps) {
	const [rows, setRows] = useState<FolderRowState[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createName, setCreateName] = useState("");
	const [createParent, setCreateParent] = useState<number | null>(null);
	const [creating, setCreating] = useState(false);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		(async () => {
			try {
				const [folders, status] = await Promise.all([
					listFolders(),
					getTweetBookmarkStatus(tweetId),
				]);
				if (cancelled) return;
				const savedIds = new Set(status.folder_ids);
				// #503 で backend が bookmark_ids を返すようになった。1 query で
				// folder_id → bookmark_id を取れるので、旧実装の N+1 list は不要。
				const bookmarkByFolder = new Map<number, number>();
				const fromStatus = status.bookmark_ids ?? {};
				for (const [fidStr, bmId] of Object.entries(fromStatus)) {
					bookmarkByFolder.set(Number(fidStr), bmId);
				}
				const ordered = buildOrderedRows(folders);
				setRows(
					ordered.map(({ folder, depth }) => ({
						folder,
						depth,
						isSaved: savedIds.has(folder.id),
						bookmarkId: bookmarkByFolder.get(folder.id) ?? null,
						isBusy: false,
					})),
				);
				onStatusChanged?.(Array.from(savedIds));
			} catch (err) {
				if (!cancelled) {
					setError(describeApiError(err, "フォルダ一覧の取得に失敗しました"));
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, tweetId, onStatusChanged]);

	const setRowBusy = (folderId: number, busy: boolean) => {
		setRows((prev) =>
			prev.map((r) => (r.folder.id === folderId ? { ...r, isBusy: busy } : r)),
		);
	};

	// #502 review H2: stale closure を避けるため、`next` は setRows の prev
	// から導出し、その結果を onStatusChanged へ渡す。
	const applyToggle = (
		folderId: number,
		updater: (row: FolderRowState) => FolderRowState,
	) => {
		setRows((prev) => {
			const next = prev.map((r) => (r.folder.id === folderId ? updater(r) : r));
			const folderIds = next.filter((r) => r.isSaved).map((r) => r.folder.id);
			onStatusChanged?.(folderIds);
			return next;
		});
	};

	const handleToggle = async (row: FolderRowState) => {
		setError(null);
		setRowBusy(row.folder.id, true);
		try {
			if (row.isSaved && row.bookmarkId !== null) {
				await deleteBookmark(row.bookmarkId);
				applyToggle(row.folder.id, (r) => ({
					...r,
					isSaved: false,
					bookmarkId: null,
					isBusy: false,
					folder: {
						...r.folder,
						bookmark_count: Math.max(0, r.folder.bookmark_count - 1),
					},
				}));
			} else {
				const result = await createBookmark({
					folder_id: row.folder.id,
					tweet_id: Number(tweetId),
				});
				applyToggle(row.folder.id, (r) => ({
					...r,
					isSaved: true,
					bookmarkId: result.bookmark.id,
					isBusy: false,
					folder: {
						...r.folder,
						bookmark_count: r.folder.bookmark_count + (result.created ? 1 : 0),
					},
				}));
			}
		} catch (err) {
			setError(describeApiError(err, "保存状態の更新に失敗しました"));
			setRowBusy(row.folder.id, false);
		}
	};

	const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const name = createName.trim();
		if (!name) {
			setError("フォルダ名を入力してください");
			return;
		}
		if (name.length > 50) {
			setError("フォルダ名は 50 文字以内にしてください");
			return;
		}
		setError(null);
		setCreating(true);
		try {
			const folder = await createFolder({
				name,
				parent_id: createParent,
			});
			setRows((prev) => {
				const merged = [...prev.map((r) => r.folder), folder];
				const ordered = buildOrderedRows(merged);
				const savedSet = new Set(
					prev.filter((r) => r.isSaved).map((r) => r.folder.id),
				);
				// type guard で `bookmarkId: number | null` から null を除外
				const bmById = new Map<number, number>(
					prev
						.filter(
							(r): r is FolderRowState & { bookmarkId: number } =>
								r.bookmarkId !== null,
						)
						.map((r) => [r.folder.id, r.bookmarkId]),
				);
				return ordered.map(({ folder: f, depth }) => ({
					folder: f,
					depth,
					isSaved: savedSet.has(f.id),
					bookmarkId: bmById.get(f.id) ?? null,
					isBusy: false,
				}));
			});
			setCreateName("");
			setCreateParent(null);
		} catch (err) {
			setError(describeApiError(err, "フォルダの作成に失敗しました"));
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>お気に入りに追加</DialogTitle>
					<DialogDescription>
						保存先のフォルダを選択するか、新規フォルダを作成してください。
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p
						role="alert"
						className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{error}
					</p>
				)}

				<div className="max-h-72 overflow-y-auto rounded border border-border">
					{loading ? (
						<p className="px-3 py-4 text-sm text-muted-foreground">
							読み込み中…
						</p>
					) : rows.length === 0 ? (
						<p className="px-3 py-4 text-sm text-muted-foreground">
							まだフォルダがありません。下から作成してください。
						</p>
					) : (
						<ul
							aria-label="お気に入りフォルダ"
							className="divide-y divide-border"
						>
							{rows.map((row) => (
								<li key={row.folder.id}>
									<label
										className="flex cursor-pointer items-center gap-2 pr-3 py-2 hover:bg-muted/40"
										style={{ paddingLeft: `${0.75 + row.depth * 1}rem` }}
										aria-label={`${row.folder.name} (ブックマーク ${row.folder.bookmark_count} 件)`}
									>
										<input
											type="checkbox"
											checked={row.isSaved}
											disabled={row.isBusy}
											onChange={() => handleToggle(row)}
											className="size-4"
										/>
										<span className="flex-1 text-sm">{row.folder.name}</span>
										<span aria-hidden className="text-xs text-muted-foreground">
											{row.folder.bookmark_count}
										</span>
									</label>
								</li>
							))}
						</ul>
					)}
				</div>

				<form onSubmit={handleCreate} className="mt-3 space-y-2">
					<label className="block text-sm font-medium">
						新規フォルダ
						<input
							type="text"
							value={createName}
							onChange={(e) => setCreateName(e.target.value)}
							maxLength={50}
							placeholder="例: 技術 / 後で読む"
							className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>
					</label>
					<label className="block text-sm">
						親フォルダ (任意)
						<select
							value={createParent ?? ""}
							onChange={(e) =>
								setCreateParent(
									e.target.value === "" ? null : Number(e.target.value),
								)
							}
							className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
						>
							<option value="">ルート</option>
							{rows.map((row) => (
								<option key={row.folder.id} value={row.folder.id}>
									{`${"  ".repeat(row.depth)}${row.folder.name}`}
								</option>
							))}
						</select>
					</label>
					<button
						type="submit"
						disabled={creating || !createName.trim()}
						className="w-full rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
					>
						{creating ? "作成中…" : "+ フォルダを作成"}
					</button>
				</form>
			</DialogContent>
		</Dialog>
	);
}
