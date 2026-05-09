"use client";

/**
 * 非画像添付の chip 表示 (Issue #462).
 *
 * - アイコン (MIME 別絵文字) + filename + size + ダウンロード link
 * - クリックで OS のダウンロードダイアログ (`<a download>`)
 * - a11y: aria-label にフルコンテキスト
 */

import { formatFileSize, iconForMime } from "@/lib/dm/attachmentDisplay";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

interface AttachmentFileChipProps {
	attachment: MessageAttachment;
}

export default function AttachmentFileChip({
	attachment,
}: AttachmentFileChipProps) {
	const sizeLabel = formatFileSize(attachment.size);
	return (
		<a
			href={attachment.url}
			download={attachment.filename}
			target="_blank"
			rel="noopener noreferrer"
			aria-label={`ダウンロード: ${attachment.filename} (${sizeLabel})`}
			className="bg-baby_veryBlack/40 hover:bg-baby_veryBlack/60 border-baby_grey/30 focus-visible:ring-baby_blue mt-1 inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-xs text-baby_white transition focus-visible:outline-none focus-visible:ring-2"
		>
			<span aria-hidden="true" className="text-base leading-none">
				{iconForMime(attachment.mime_type)}
			</span>
			<span className="min-w-0 flex-1 truncate font-medium">
				{attachment.filename}
			</span>
			<span className="text-baby_grey shrink-0">{sizeLabel}</span>
			<span aria-hidden="true" className="text-baby_grey shrink-0">
				⬇
			</span>
		</a>
	);
}
