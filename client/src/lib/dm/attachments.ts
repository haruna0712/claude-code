/**
 * DM 添付の S3 直アップロード API ヘルパ (P3-10 / Issue #235).
 *
 * フロー:
 *   1. POST /api/v1/dm/attachments/presign/  → { url, fields, s3_key, expires_at }
 *   2. multipart/form-data で S3 へ POST (XMLHttpRequest で進捗 track)
 *   3. POST /api/v1/dm/attachments/confirm/  → { id, s3_key, ... }
 *   4. send_message に attachment_ids: [id] を渡す
 *
 * MIME / size 検証はクライアント + サーバ両方で行う (UX + security)。
 */

import axios from "axios";

import { createApiClient } from "@/lib/api/client";

export const ATTACHMENT_LIMITS = {
	imageMaxBytes: 10 * 1024 * 1024,
	fileMaxBytes: 25 * 1024 * 1024,
	allowedImageTypes: [
		"image/jpeg",
		"image/png",
		"image/webp",
		"image/gif",
	] as const,
	allowedFileTypes: [
		"application/pdf",
		"application/zip",
		"text/plain",
	] as const,
	maxImagesPerMessage: 5,
	maxFilesPerMessage: 1,
} as const;

export const ALL_ALLOWED_MIME_TYPES = [
	...ATTACHMENT_LIMITS.allowedImageTypes,
	...ATTACHMENT_LIMITS.allowedFileTypes,
] as const;

export type AllowedMimeType = (typeof ALL_ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
	return (ALL_ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export function isImageMime(mime: string): boolean {
	return (ATTACHMENT_LIMITS.allowedImageTypes as readonly string[]).includes(
		mime,
	);
}

export function maxBytesFor(mime: string): number {
	if (isImageMime(mime)) return ATTACHMENT_LIMITS.imageMaxBytes;
	return ATTACHMENT_LIMITS.fileMaxBytes;
}

export interface ValidationError {
	field: "mime" | "size" | "filename";
	message: string;
}

export function validateAttachment(file: File): ValidationError | null {
	if (!isAllowedMimeType(file.type)) {
		return {
			field: "mime",
			message: `非対応のファイル形式です: ${file.type || "(unknown)"}`,
		};
	}
	const limit = maxBytesFor(file.type);
	if (file.size <= 0) {
		return { field: "size", message: "ファイルが空です" };
	}
	if (file.size > limit) {
		return {
			field: "size",
			message: `${Math.round(limit / 1024 / 1024)}MB を超えています`,
		};
	}
	if (
		file.name.includes("..") ||
		file.name.includes("/") ||
		file.name.includes("\\")
	) {
		return {
			field: "filename",
			message: "ファイル名に使用できない文字が含まれています",
		};
	}
	return null;
}

export interface PresignResponse {
	url: string;
	fields: Record<string, string>;
	s3_key: string;
	expires_at: string;
}

export interface ConfirmResponse {
	id: number;
	s3_key: string;
	filename: string;
	mime_type: string;
	size: number;
}

export interface UploadProgress {
	loaded: number;
	total: number;
}

const client = createApiClient();

export async function requestPresign(input: {
	roomId: number;
	filename: string;
	mimeType: string;
	size: number;
}): Promise<PresignResponse> {
	const { data } = await client.post<PresignResponse>(
		"/dm/attachments/presign/",
		{
			room_id: input.roomId,
			filename: input.filename,
			mime_type: input.mimeType,
			size: input.size,
		},
	);
	return data;
}

/**
 * S3 へ multipart POST。進捗は XMLHttpRequest 経由 (axios でも progress 取れるが、
 * S3 は CORS で `progress` event を許可するため XHR の挙動を直接活用する)。
 */
export function uploadToS3(input: {
	presign: PresignResponse;
	file: File;
	onProgress?: (p: UploadProgress) => void;
	signal?: AbortSignal;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("POST", input.presign.url, true);
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable && input.onProgress) {
				input.onProgress({ loaded: event.loaded, total: event.total });
			}
		};
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) resolve();
			else reject(new Error(`S3 upload failed: HTTP ${xhr.status}`));
		};
		xhr.onerror = () => reject(new Error("S3 upload network error"));
		xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
		input.signal?.addEventListener("abort", () => xhr.abort());

		const form = new FormData();
		for (const [k, v] of Object.entries(input.presign.fields)) {
			form.append(k, v);
		}
		form.append("file", input.file);
		xhr.send(form);
	});
}

export async function confirmAttachment(input: {
	roomId: number;
	s3Key: string;
	filename: string;
	mimeType: string;
	size: number;
}): Promise<ConfirmResponse> {
	const { data } = await client.post<ConfirmResponse>(
		"/dm/attachments/confirm/",
		{
			room_id: input.roomId,
			s3_key: input.s3Key,
			filename: input.filename,
			mime_type: input.mimeType,
			size: input.size,
		},
	);
	return data;
}

/**
 * presign → S3 PUT → confirm を 1 ステップで実行する高レベル API。
 * 進捗は onProgress に渡す (S3 PUT 区間のみ、presign / confirm は瞬時)。
 */
export async function uploadAttachment(input: {
	roomId: number;
	file: File;
	onProgress?: (p: UploadProgress) => void;
	signal?: AbortSignal;
}): Promise<ConfirmResponse> {
	const validation = validateAttachment(input.file);
	if (validation) {
		throw new Error(validation.message);
	}
	const presign = await requestPresign({
		roomId: input.roomId,
		filename: input.file.name,
		mimeType: input.file.type,
		size: input.file.size,
	});
	await uploadToS3({
		presign,
		file: input.file,
		onProgress: input.onProgress,
		signal: input.signal,
	});
	return confirmAttachment({
		roomId: input.roomId,
		s3Key: presign.s3_key,
		filename: input.file.name,
		mimeType: input.file.type,
		size: input.file.size,
	});
}

// axios import を残すため (一部の bundler 解析で削除されるのを防ぐ)
export const __axios = axios;
