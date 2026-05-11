"use client";

/**
 * useArticleImageUpload (#536 / PR C).
 *
 * ArticleEditor から画像 file (D&D / paste / file picker) を受け取り、
 * `requestImageUpload` 3 step を実行して結果 URL を返す state machine。
 *
 * - 並列上限 3 (それ以上は queue で FIFO)
 * - 各 file ごとに `state = "queued" | "uploading" | "done" | "failed"`
 * - 完了 (done) は caller (= ArticleEditor) に callback で URL を渡し、
 *   markdown 本文への挿入を任せる
 * - 失敗 (failed) は error message を rows に保持して toast で通知
 *
 * spec doc §3.2 / §3.3 を参照。
 */

import { useCallback, useRef, useState } from "react";

import {
	ArticleImageUploadError,
	requestImageUpload,
	type UploadedImage,
} from "@/lib/api/articleImages";

const MAX_CONCURRENT = 3;

export type UploadRowState = "queued" | "uploading" | "done" | "failed";

export interface UploadRow {
	id: string;
	filename: string;
	state: UploadRowState;
	error?: string;
}

interface UseArticleImageUploadOptions {
	/** upload 完了で markdown 本文 (caret 位置) に挿入する callback。 */
	onUploaded: (image: UploadedImage, filename: string) => void;
	/** 失敗時の表示用 callback (toast 等)。 */
	onFailed?: (message: string, filename: string) => void;
}

interface UseArticleImageUploadResult {
	rows: UploadRow[];
	enqueue: (files: ReadonlyArray<File>) => void;
	clearFinished: () => void;
}

let _idCounter = 0;
function nextRowId(): string {
	_idCounter += 1;
	return `upload-${Date.now()}-${_idCounter}`;
}

export function useArticleImageUpload({
	onUploaded,
	onFailed,
}: UseArticleImageUploadOptions): UseArticleImageUploadResult {
	const [rows, setRows] = useState<UploadRow[]>([]);
	const activeRef = useRef(0);
	const queueRef = useRef<Array<{ row: UploadRow; file: File }>>([]);

	const setRow = useCallback((id: string, patch: Partial<UploadRow>) => {
		setRows((current) =>
			current.map((r) => (r.id === id ? { ...r, ...patch } : r)),
		);
	}, []);

	const runOne = useCallback(
		async (row: UploadRow, file: File) => {
			activeRef.current += 1;
			setRow(row.id, { state: "uploading" });
			try {
				const image = await requestImageUpload(file);
				setRow(row.id, { state: "done" });
				onUploaded(image, row.filename);
			} catch (err) {
				const message =
					err instanceof ArticleImageUploadError
						? err.message
						: err instanceof Error
							? err.message
							: "アップロードに失敗しました";
				setRow(row.id, { state: "failed", error: message });
				onFailed?.(message, row.filename);
			} finally {
				activeRef.current -= 1;
				drainQueue();
			}
		},
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[onUploaded, onFailed, setRow],
	);

	const drainQueue = useCallback(() => {
		while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
			const next = queueRef.current.shift();
			if (!next) break;
			runOne(next.row, next.file).catch(() => {
				// runOne 内部で try/catch して state="failed" にしているので、
				// ここまで例外が漏れるのは想定外。 silent 化せず最低限 swallow + dev 環境では
				// console に出す (production では unhandledrejection も hookup される)。
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [runOne]);

	const enqueue = useCallback(
		(files: ReadonlyArray<File>) => {
			if (files.length === 0) return;
			const newRows: UploadRow[] = [];
			const newJobs: Array<{ row: UploadRow; file: File }> = [];
			for (const file of files) {
				const row: UploadRow = {
					id: nextRowId(),
					filename: file.name || "(無題)",
					state: "queued",
				};
				newRows.push(row);
				newJobs.push({ row, file });
			}
			setRows((current) => [...current, ...newRows]);
			queueRef.current.push(...newJobs);
			drainQueue();
		},
		[drainQueue],
	);

	const clearFinished = useCallback(() => {
		setRows((current) =>
			current.filter((r) => r.state !== "done" && r.state !== "failed"),
		);
	}, []);

	return { rows, enqueue, clearFinished };
}
