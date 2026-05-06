"use client";

import { useRouter } from "next/navigation";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "react-toastify";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import TweetComposer from "@/components/tweets/TweetComposer";
import type { TweetSummary } from "@/lib/api/tweets";

interface ComposeTweetDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * 投稿成功時に親へ通知する。指定しない場合は `router.refresh()` で
	 * 現在のページの SSR 部分を再取得する (例: ホーム画面 TL の更新)。
	 */
	onPosted?: (tweet: TweetSummary) => void;
}

/**
 * ComposeTweetDialog — 左下 + ボタンから開く root tweet 投稿ダイアログ (#396)。
 *
 * 既存 `TweetComposer` を Radix Dialog でラップしているだけ。投稿成功で
 * 自動 close + toast、router.refresh で TL 再取得。文字数カウント / タグ /
 * バリデーションは TweetComposer 側に閉じている。
 *
 * a11y:
 *  - DialogTitle (sr-only) で dialog にアクセシブル名を与える (4.1.2)
 *  - 投稿成功は sr-only aria-live で SR 利用者にも通知 (4.1.3 Status Messages)
 *  - dialog open 時は `onOpenAutoFocus` で textarea へ deterministic に focus
 */
export default function ComposeTweetDialog({
	open,
	onOpenChange,
	onPosted,
}: ComposeTweetDialogProps): ReactElement {
	const router = useRouter();
	const contentRef = useRef<HTMLDivElement | null>(null);
	const [liveMessage, setLiveMessage] = useState("");

	// dialog が閉じたら live region を空に戻す (毎回再 announce できるように)
	useEffect(() => {
		if (!open) setLiveMessage("");
	}, [open]);

	const handlePosted = useCallback(
		(tweet: TweetSummary) => {
			onPosted?.(tweet);
			setLiveMessage("ツイートを投稿しました");
			onOpenChange(false);
			toast.success("投稿しました");
			router.refresh();
		},
		[onPosted, onOpenChange, router],
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				ref={contentRef}
				aria-describedby={undefined}
				onOpenAutoFocus={(event) => {
					// Radix の既定 (first focusable) を上書きし、本文 textarea を
					// 確実に focus する (TweetComposer 内の textarea が最初の input)。
					event.preventDefault();
					const textarea = contentRef.current?.querySelector("textarea");
					textarea?.focus();
				}}
				className="w-[92vw] max-w-xl"
			>
				<DialogTitle className="sr-only">投稿する</DialogTitle>
				<TweetComposer onPosted={handlePosted} autoFocus />
			</DialogContent>
			<div role="status" aria-live="polite" className="sr-only">
				{liveMessage}
			</div>
		</Dialog>
	);
}
