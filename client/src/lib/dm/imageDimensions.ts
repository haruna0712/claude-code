/**
 * 画像ファイルの実寸 (naturalWidth / naturalHeight) を計測する (Issue #461).
 *
 * - non-image MIME には null を返す
 * - 壊れた image / timeout で null (送信ブロックしない)
 * - Object URL は finally で必ず revoke (メモリリーク防止)
 */

const DEFAULT_TIMEOUT_MS = 5000;

export interface ImageDimensions {
	width: number;
	height: number;
}

export async function measureImageDimensions(
	file: File,
	timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ImageDimensions | null> {
	if (!file.type.startsWith("image/")) {
		return null;
	}
	if (typeof window === "undefined" || typeof URL === "undefined") {
		return null; // SSR (jsdom 含まず)
	}

	return new Promise<ImageDimensions | null>((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		let settled = false;
		const finish = (result: ImageDimensions | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			URL.revokeObjectURL(url);
			resolve(result);
		};
		const timer = setTimeout(() => finish(null), timeoutMs);
		img.onload = () => {
			finish({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => finish(null);
		img.src = url;
	});
}
