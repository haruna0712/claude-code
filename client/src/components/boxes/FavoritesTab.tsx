"use client";

/**
 * FavoritesTab (#499) — プロフィールの「お気に入り」 タブ本体.
 *
 * docs/specs/favorites-spec.md §5.1 に従う Google ブックマーク マネージャ風 UI.
 * - 左ペイン: フォルダツリー (parent_id でツリー構築、深さインデント)
 * - 右ペイン: 選択中フォルダ配下の Bookmark を TweetCard 風に列挙
 * - 自分のプロフィールのみ表示 (本 component は呼ぶ側で gate される)
 *
 * MVP: 一覧 + 保存済 tweet の表示まで。folder rename / delete / 並び替えは
 * AddToFolderDialog (作成) と TweetCard (削除) で十分賄えるため後続で対応。
 */

import { useEffect, useMemo, useState } from "react";

import TweetCardList from "@/components/timeline/TweetCardList";
import { listFolderBookmarks, listFolders, type Folder } from "@/lib/api/boxes";
import { fetchTweet, type TweetSummary } from "@/lib/api/tweets";

interface FavoritesTabProps {
	currentUserHandle: string;
}

interface FolderRow {
	folder: Folder;
	depth: number;
}

function buildOrderedRows(folders: Folder[]): FolderRow[] {
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
	const rows: FolderRow[] = [];
	const visit = (parentId: number | null, depth: number) => {
		for (const f of byParent.get(parentId) ?? []) {
			rows.push({ folder: f, depth });
			visit(f.id, depth + 1);
		}
	};
	visit(null, 0);
	return rows;
}

export default function FavoritesTab({ currentUserHandle }: FavoritesTabProps) {
	const [folders, setFolders] = useState<Folder[] | null>(null);
	const [folderError, setFolderError] = useState<string | null>(null);
	const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
	const [tweets, setTweets] = useState<TweetSummary[] | null>(null);
	const [tweetsLoading, setTweetsLoading] = useState(false);
	const [tweetsError, setTweetsError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const list = await listFolders();
				if (cancelled) return;
				setFolders(list);
				// 初期選択は functional updater で導出する。`selectedFolderId` を
				// dep に入れずに済むので exhaustive-deps の disable も不要。
				setSelectedFolderId((prev) => {
					if (prev !== null || list.length === 0) return prev;
					return (list.find((f) => f.parent_id === null) ?? list[0]).id;
				});
			} catch (err) {
				if (!cancelled) {
					setFolderError(
						err instanceof Error
							? err.message
							: "フォルダ一覧の取得に失敗しました",
					);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (selectedFolderId === null) return;
		let cancelled = false;
		setTweets(null);
		setTweetsLoading(true);
		setTweetsError(null);
		(async () => {
			try {
				const bookmarks = await listFolderBookmarks(selectedFolderId);
				const summaries = await Promise.all(
					bookmarks.map((bm) => fetchTweet(bm.tweet_id).catch(() => null)),
				);
				if (cancelled) return;
				setTweets(summaries.filter((t): t is TweetSummary => t !== null));
			} catch (err) {
				if (!cancelled) {
					setTweetsError(
						err instanceof Error
							? err.message
							: "保存ツイートの取得に失敗しました",
					);
				}
			} finally {
				if (!cancelled) setTweetsLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [selectedFolderId]);

	const rows = useMemo(
		() => (folders ? buildOrderedRows(folders) : []),
		[folders],
	);

	if (folderError) {
		return (
			<p
				role="alert"
				className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
			>
				{folderError}
			</p>
		);
	}

	if (folders === null) {
		return (
			<p className="px-2 py-6 text-sm text-muted-foreground">読み込み中…</p>
		);
	}

	if (folders.length === 0) {
		return (
			<p className="px-2 py-6 text-sm text-muted-foreground">
				まだフォルダがありません。タイムラインの 🔖
				アイコンから保存すると、ここに表示されます。
			</p>
		);
	}

	return (
		<div className="grid gap-4 sm:grid-cols-[14rem_1fr]">
			<aside
				aria-label="お気に入りフォルダ"
				className="rounded border border-border"
			>
				<ul className="divide-y divide-border">
					{rows.map(({ folder, depth }) => {
						const isActive = folder.id === selectedFolderId;
						return (
							<li key={folder.id}>
								<button
									type="button"
									onClick={() => setSelectedFolderId(folder.id)}
									aria-current={isActive || undefined}
									aria-label={`${folder.name} (ブックマーク ${folder.bookmark_count} 件)`}
									className={`flex w-full items-center justify-between pr-3 py-2 text-left text-sm transition-colors ${
										isActive
											? "bg-primary/10 text-foreground"
											: "hover:bg-muted/40 text-muted-foreground"
									}`}
									style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
								>
									<span className="truncate">📁 {folder.name}</span>
									<span aria-hidden className="text-xs">
										{folder.bookmark_count}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			</aside>

			<section aria-label="保存ツイート">
				{tweetsError && (
					<p
						role="alert"
						className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{tweetsError}
					</p>
				)}
				{tweetsLoading ? (
					<p className="px-2 py-6 text-sm text-muted-foreground">読み込み中…</p>
				) : (
					<TweetCardList
						tweets={tweets ?? []}
						ariaLabel="保存ツイート"
						emptyMessage="このフォルダにはまだ保存されていません。"
						currentUserHandle={currentUserHandle}
					/>
				)}
			</section>
		</div>
	);
}
