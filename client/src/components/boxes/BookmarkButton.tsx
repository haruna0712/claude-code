"use client";

/**
 * BookmarkButton (#499) — TweetCard footer から AddToFolderDialog を開くトリガ.
 *
 * - 未保存: 線アイコン (Bookmark)
 * - 保存済 (1+ folder): 塗りアイコン (BookmarkCheck) + baby_blue 着色
 * - click で AddToFolderDialog を open
 * - 初期状態は親が server fetch で渡す (TweetSummary.bookmark_folder_ids など、
 *   未供給なら未保存として描画し、Dialog open 時に同期される)。
 */

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";

import AddToFolderDialog from "@/components/boxes/AddToFolderDialog";

interface BookmarkButtonProps {
	tweetId: number | string;
	initialFolderIds?: number[];
}

export default function BookmarkButton({
	tweetId,
	initialFolderIds = [],
}: BookmarkButtonProps) {
	const [open, setOpen] = useState(false);
	const [folderIds, setFolderIds] = useState<number[]>(initialFolderIds);
	const isSaved = folderIds.length > 0;

	return (
		<>
			<button
				type="button"
				aria-label={
					isSaved ? "お気に入り済み (フォルダを編集)" : "お気に入りに追加"
				}
				aria-pressed={isSaved}
				onClick={() => setOpen(true)}
				className="flex items-center gap-1 min-h-[32px] px-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
			>
				{isSaved ? (
					<BookmarkCheck className="size-4 text-baby_blue" aria-hidden="true" />
				) : (
					<Bookmark className="size-4" aria-hidden="true" />
				)}
				<span className="sr-only sm:not-sr-only">お気に入り</span>
			</button>
			<AddToFolderDialog
				tweetId={tweetId}
				open={open}
				onOpenChange={setOpen}
				onStatusChanged={setFolderIds}
			/>
		</>
	);
}
