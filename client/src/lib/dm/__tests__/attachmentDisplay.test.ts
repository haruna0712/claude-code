/**
 * attachmentDisplay 純粋関数テスト (Issue #462).
 */

import { describe, expect, it } from "vitest";

import {
	formatFileSize,
	iconForMime,
	isImageAttachment,
	partitionAttachments,
} from "@/lib/dm/attachmentDisplay";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

const mkAtt = (over: Partial<MessageAttachment>): MessageAttachment => ({
	id: 1,
	s3_key: "dm/1/x.png",
	url: "https://stg.example/dm/1/x.png",
	filename: "x.png",
	mime_type: "image/png",
	size: 1024,
	width: null,
	height: null,
	...over,
});

describe("isImageAttachment", () => {
	it("image/* で true", () => {
		expect(isImageAttachment(mkAtt({ mime_type: "image/png" }))).toBe(true);
		expect(isImageAttachment(mkAtt({ mime_type: "image/jpeg" }))).toBe(true);
	});
	it("application/pdf で false", () => {
		expect(isImageAttachment(mkAtt({ mime_type: "application/pdf" }))).toBe(
			false,
		);
	});
});

describe("formatFileSize", () => {
	it("B / KB / MB を桁で切り替え", () => {
		expect(formatFileSize(0)).toBe("0 B");
		expect(formatFileSize(500)).toBe("500 B");
		expect(formatFileSize(2048)).toBe("2.0 KB");
		expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
		expect(formatFileSize(1572864)).toBe("1.5 MB");
	});
	it("負の値は 0 B", () => {
		expect(formatFileSize(-100)).toBe("0 B");
	});
});

describe("iconForMime", () => {
	it("MIME 別アイコン", () => {
		expect(iconForMime("image/png")).toBe("🖼️");
		expect(iconForMime("application/pdf")).toBe("📄");
		expect(iconForMime("text/plain")).toBe("📝");
		expect(iconForMime("application/zip")).toBe("🗜️");
		expect(iconForMime("audio/mp3")).toBe("🎵");
		expect(iconForMime("video/mp4")).toBe("🎬");
		expect(iconForMime("application/octet-stream")).toBe("📎");
	});
});

describe("partitionAttachments", () => {
	it("画像と非画像を分割", () => {
		const attachments = [
			mkAtt({ id: 1, mime_type: "image/png" }),
			mkAtt({ id: 2, mime_type: "application/pdf" }),
			mkAtt({ id: 3, mime_type: "image/jpeg" }),
			mkAtt({ id: 4, mime_type: "text/plain" }),
		];
		const { images, files } = partitionAttachments(attachments);
		expect(images.map((a) => a.id)).toEqual([1, 3]);
		expect(files.map((a) => a.id)).toEqual([2, 4]);
	});
	it("空配列で空 partition", () => {
		expect(partitionAttachments([])).toEqual({ images: [], files: [] });
	});
});
