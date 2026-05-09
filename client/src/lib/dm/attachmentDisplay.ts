/**
 * 添付表示用 純粋関数 (Issue #462).
 */

import type { MessageAttachment } from "@/lib/redux/features/dm/types";

export function isImageAttachment(att: MessageAttachment): boolean {
	return att.mime_type.startsWith("image/");
}

export function formatFileSize(bytes: number): string {
	if (bytes < 0) return "0 B";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** non-image 用アイコン文字列 (絵文字)。lucide icon 化は将来。 */
export function iconForMime(mimeType: string): string {
	if (mimeType.startsWith("image/")) return "🖼️";
	if (mimeType === "application/pdf") return "📄";
	if (mimeType.startsWith("text/")) return "📝";
	if (mimeType.includes("zip") || mimeType.includes("archive")) return "🗜️";
	if (mimeType.includes("audio")) return "🎵";
	if (mimeType.includes("video")) return "🎬";
	return "📎";
}

/** 画像とそれ以外を分割 (Grid と FileChip 列で別 render する) */
export function partitionAttachments(attachments: MessageAttachment[]): {
	images: MessageAttachment[];
	files: MessageAttachment[];
} {
	const images: MessageAttachment[] = [];
	const files: MessageAttachment[] = [];
	for (const att of attachments) {
		(isImageAttachment(att) ? images : files).push(att);
	}
	return { images, files };
}
