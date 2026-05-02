/**
 * Tests for client/src/lib/dm/attachments.ts (P3-10 / Issue #235).
 *
 * - validateAttachment: mime / size / filename traversal
 * - isAllowedMimeType / isImageMime / maxBytesFor
 *
 * uploadToS3 / requestPresign / confirmAttachment は network/XHR を伴うため
 * E2E (P3-21) でカバーし、ここでは validation/utility のみ unit test。
 */

import { describe, expect, it } from "vitest";

import {
	ATTACHMENT_LIMITS,
	isAllowedMimeType,
	isImageMime,
	maxBytesFor,
	validateAttachment,
} from "@/lib/dm/attachments";

function makeFile(name: string, type: string, size: number): File {
	const blob = new Blob([new Uint8Array(Math.min(size, 1))], { type });
	const file = new File([blob], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

describe("isAllowedMimeType", () => {
	it("画像 MIME を許可", () => {
		expect(isAllowedMimeType("image/jpeg")).toBe(true);
		expect(isAllowedMimeType("image/png")).toBe(true);
		expect(isAllowedMimeType("image/webp")).toBe(true);
		expect(isAllowedMimeType("image/gif")).toBe(true);
	});

	it("ファイル MIME を許可", () => {
		expect(isAllowedMimeType("application/pdf")).toBe(true);
		expect(isAllowedMimeType("application/zip")).toBe(true);
		expect(isAllowedMimeType("text/plain")).toBe(true);
	});

	it("非対応 MIME を拒否", () => {
		expect(isAllowedMimeType("image/heic")).toBe(false);
		expect(isAllowedMimeType("video/mp4")).toBe(false);
		expect(isAllowedMimeType("")).toBe(false);
	});
});

describe("isImageMime", () => {
	it("画像系を識別", () => {
		expect(isImageMime("image/jpeg")).toBe(true);
		expect(isImageMime("application/pdf")).toBe(false);
	});
});

describe("maxBytesFor", () => {
	it("画像は 10MB", () => {
		expect(maxBytesFor("image/jpeg")).toBe(ATTACHMENT_LIMITS.imageMaxBytes);
	});

	it("ファイルは 25MB", () => {
		expect(maxBytesFor("application/pdf")).toBe(ATTACHMENT_LIMITS.fileMaxBytes);
	});
});

describe("validateAttachment", () => {
	it("正常な画像は null", () => {
		expect(
			validateAttachment(makeFile("photo.jpg", "image/jpeg", 1024)),
		).toBeNull();
	});

	it("非対応 MIME は field=mime", () => {
		expect(
			validateAttachment(makeFile("x.heic", "image/heic", 100))?.field,
		).toBe("mime");
	});

	it("画像の上限超過 (10MB)", () => {
		const v = validateAttachment(
			makeFile("big.jpg", "image/jpeg", 11 * 1024 * 1024),
		);
		expect(v?.field).toBe("size");
	});

	it("ファイルの上限超過 (25MB)", () => {
		const v = validateAttachment(
			makeFile("big.pdf", "application/pdf", 26 * 1024 * 1024),
		);
		expect(v?.field).toBe("size");
	});

	it("空ファイルは拒否", () => {
		const v = validateAttachment(makeFile("empty.txt", "text/plain", 0));
		expect(v?.field).toBe("size");
	});

	it("path traversal を含む filename を拒否", () => {
		expect(
			validateAttachment(makeFile("../etc/p.txt", "text/plain", 100))?.field,
		).toBe("filename");
		expect(
			validateAttachment(makeFile("dir/p.txt", "text/plain", 100))?.field,
		).toBe("filename");
	});
});
