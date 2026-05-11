/**
 * Article image upload API wrapper (#536 / PR C).
 *
 * P6-04 (#591) で実装した 2 endpoint:
 *
 *   POST /api/v1/articles/images/presign/  → { url, fields, s3_key, expires_at }
 *   POST /api/v1/articles/images/confirm/  → { id, s3_key, url, width, height, size, ... }
 *
 * を 3 step (presign → S3 直 PUT → confirm) で順番に呼ぶ薄い wrapper。 失敗時は
 * `Error` を throw する。 caller (= `useArticleImageUpload`) は state machine を
 * 担当する。
 *
 * NOTE: S3 への POST は **本サーバ API ではなく** S3 host へ直接送るので axios
 * (= 既存 `api` instance) は経由しない。 `fetch` で送信し credentials は付与しない
 * (presigned URL に署名が乗っているため)。
 */

import type { AxiosInstance } from "axios";

import { api, ensureCsrfToken } from "@/lib/api/client";

const ALLOWED_MIME = new Set<string>([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
]);
const MAX_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
	id: string;
	s3_key: string;
	url: string;
	width: number;
	height: number;
	size: number;
}

interface PresignResponse {
	url: string;
	fields: Record<string, string>;
	s3_key: string;
	expires_at: string;
}

interface ConfirmResponse {
	id: string;
	s3_key: string;
	url: string;
	width: number;
	height: number;
	size: number;
	created_at: string;
}

export class ArticleImageUploadError extends Error {
	constructor(
		message: string,
		readonly step: "validate" | "presign" | "s3" | "dimensions" | "confirm",
	) {
		super(message);
		this.name = "ArticleImageUploadError";
	}
}

/**
 * file 単体の制約 (mime / size) を frontend 側で先にチェック。 backend は再検証する。
 */
export function validateImageFile(file: File): void {
	if (!ALLOWED_MIME.has(file.type)) {
		throw new ArticleImageUploadError(
			`このファイル形式は対応していません: ${file.type || "不明"}`,
			"validate",
		);
	}
	if (file.size <= 0 || file.size > MAX_BYTES) {
		throw new ArticleImageUploadError(
			`ファイルサイズは 1B〜5MiB にしてください (実: ${file.size}B)`,
			"validate",
		);
	}
}

/**
 * HTMLImageElement.naturalWidth/Height をクライアント側で計測する。
 * confirm endpoint に渡す必須フィールド。
 */
async function readImageDimensions(
	file: File,
): Promise<{ width: number; height: number }> {
	return await new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const img = new Image();
		img.onload = () => {
			const width = img.naturalWidth || 0;
			const height = img.naturalHeight || 0;
			URL.revokeObjectURL(url);
			if (width < 1 || height < 1) {
				reject(
					new ArticleImageUploadError(
						"画像の寸法を取得できませんでした",
						"dimensions",
					),
				);
				return;
			}
			resolve({ width, height });
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(
				new ArticleImageUploadError(
					"画像の読み込みに失敗しました",
					"dimensions",
				),
			);
		};
		img.src = url;
	});
}

/**
 * 3 step (presign → S3 PUT → confirm) を直列で実行して `UploadedImage` を返す。
 * 失敗時は `ArticleImageUploadError` を throw する (step 名つき)。
 */
export async function requestImageUpload(
	file: File,
	client: AxiosInstance = api,
): Promise<UploadedImage> {
	validateImageFile(file);

	// 1. presign URL を取得 (CSRF token は ensureCsrfToken で先に taking)
	await ensureCsrfToken(client);
	let presign: PresignResponse;
	try {
		const res = await client.post<PresignResponse>(
			"/articles/images/presign/",
			{
				filename: file.name || `image.${guessExtension(file.type)}`,
				mime_type: file.type,
				size: file.size,
			},
		);
		presign = res.data;
	} catch (err) {
		throw new ArticleImageUploadError(
			extractApiMessage(err, "presigned URL の取得に失敗しました"),
			"presign",
		);
	}

	// 2. S3 直 POST (presigned form fields + file)
	// typescript-reviewer M-2 反映: stall した接続を 30 秒で abort する。
	// AbortSignal.timeout は Node 18 / 主要ブラウザ 2023 以降で対応。
	try {
		const formData = new FormData();
		for (const [k, v] of Object.entries(presign.fields)) {
			formData.append(k, v);
		}
		formData.append("file", file);
		const s3Res = await fetch(presign.url, {
			method: "POST",
			body: formData,
			signal: AbortSignal.timeout(30_000),
			// presigned 署名で auth するので credentials は不要
		});
		if (!s3Res.ok) {
			throw new ArticleImageUploadError(
				`S3 アップロードに失敗しました (${s3Res.status})`,
				"s3",
			);
		}
	} catch (err) {
		if (err instanceof ArticleImageUploadError) throw err;
		// abort (timeout) は DOMException name="TimeoutError" として throw される
		if (err instanceof Error && err.name === "TimeoutError") {
			throw new ArticleImageUploadError(
				"S3 アップロードがタイムアウトしました (30 秒)",
				"s3",
			);
		}
		throw new ArticleImageUploadError(
			err instanceof Error ? err.message : "S3 アップロードに失敗しました",
			"s3",
		);
	}

	// 3. dimensions を計測
	const { width, height } = await readImageDimensions(file);

	// 4. confirm で head_object 再検証 + ArticleImage row 作成
	try {
		await ensureCsrfToken(client);
		const res = await client.post<ConfirmResponse>(
			"/articles/images/confirm/",
			{
				s3_key: presign.s3_key,
				filename: file.name || `image.${guessExtension(file.type)}`,
				mime_type: file.type,
				size: file.size,
				width,
				height,
			},
		);
		return {
			id: res.data.id,
			s3_key: res.data.s3_key,
			url: res.data.url,
			width: res.data.width,
			height: res.data.height,
			size: res.data.size,
		};
	} catch (err) {
		throw new ArticleImageUploadError(
			extractApiMessage(err, "画像の確定に失敗しました"),
			"confirm",
		);
	}
}

function guessExtension(mime: string): string {
	switch (mime) {
		case "image/jpeg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/webp":
			return "webp";
		case "image/gif":
			return "gif";
		default:
			return "bin";
	}
}

function extractApiMessage(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { data?: { detail?: string; [k: string]: unknown } };
			message?: string;
		};
		const data = e.response?.data;
		if (data && typeof data === "object") {
			if (typeof data.detail === "string") return data.detail;
			const firstField = Object.values(data)[0];
			if (Array.isArray(firstField) && typeof firstField[0] === "string") {
				return firstField[0];
			}
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}
