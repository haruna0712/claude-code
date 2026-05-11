/**
 * Tests for useArticleImageUpload (#536 / PR C).
 *
 * 検証:
 *   T-UPLOAD-1 valid file → uploading → done に遷移、 onUploaded callback で url が渡る
 *   T-UPLOAD-2 requestImageUpload reject → state=failed、 onFailed callback、 onUploaded 呼ばない
 *   T-UPLOAD-3 同時 5 件 enqueue → max 3 並列 (4-5 件目は queue で待ち)
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useArticleImageUpload } from "@/hooks/useArticleImageUpload";
import {
	ArticleImageUploadError,
	type UploadedImage,
} from "@/lib/api/articleImages";

const { requestImageUploadMock } = vi.hoisted(() => ({
	requestImageUploadMock: vi.fn(),
}));

vi.mock("@/lib/api/articleImages", async () => {
	const actual = await vi.importActual<
		typeof import("@/lib/api/articleImages")
	>("@/lib/api/articleImages");
	return {
		...actual,
		requestImageUpload: requestImageUploadMock,
	};
});

function makeFile(name = "test.png", type = "image/png", size = 1024): File {
	const file = new File(["x".repeat(size)], name, { type });
	// File constructor in jsdom sets size from blob parts; if mismatch, override.
	if (file.size !== size) {
		Object.defineProperty(file, "size", { value: size });
	}
	return file;
}

function fakeImage(url = "https://cdn.example.com/x.png"): UploadedImage {
	return { id: "x", s3_key: "k", url, width: 100, height: 100, size: 100 };
}

describe("useArticleImageUpload", () => {
	beforeEach(() => {
		requestImageUploadMock.mockReset();
	});

	it("T-UPLOAD-1 valid file → uploading → done、 onUploaded で url が渡る", async () => {
		const image = fakeImage();
		requestImageUploadMock.mockResolvedValueOnce(image);
		const onUploaded = vi.fn();
		const onFailed = vi.fn();
		const { result } = renderHook(() =>
			useArticleImageUpload({ onUploaded, onFailed }),
		);

		const file = makeFile("hello.png");
		act(() => {
			result.current.enqueue([file]);
		});

		// queued or uploading 状態の row が 1 件
		expect(result.current.rows).toHaveLength(1);
		expect(["queued", "uploading"]).toContain(result.current.rows[0]?.state);

		await waitFor(() => {
			expect(onUploaded).toHaveBeenCalledTimes(1);
		});
		expect(onUploaded).toHaveBeenCalledWith(image, "hello.png");
		expect(onFailed).not.toHaveBeenCalled();
		expect(result.current.rows[0]?.state).toBe("done");
	});

	it("T-UPLOAD-2 requestImageUpload reject → state=failed、 onFailed callback", async () => {
		requestImageUploadMock.mockRejectedValueOnce(
			new ArticleImageUploadError("size too large", "validate"),
		);
		const onUploaded = vi.fn();
		const onFailed = vi.fn();
		const { result } = renderHook(() =>
			useArticleImageUpload({ onUploaded, onFailed }),
		);

		act(() => {
			result.current.enqueue([makeFile("big.png")]);
		});

		await waitFor(() => {
			expect(onFailed).toHaveBeenCalledTimes(1);
		});
		expect(onFailed).toHaveBeenCalledWith("size too large", "big.png");
		expect(onUploaded).not.toHaveBeenCalled();
		expect(result.current.rows[0]?.state).toBe("failed");
		expect(result.current.rows[0]?.error).toBe("size too large");
	});

	it("T-UPLOAD-3 enqueue 5 件 → 並列 3 が走り 4-5 件目は queue", async () => {
		// 各 upload を手動で resolve できるよう Promise を保持
		const resolvers: Array<() => void> = [];
		requestImageUploadMock.mockImplementation(
			() =>
				new Promise<UploadedImage>((resolve) => {
					resolvers.push(() => resolve(fakeImage()));
				}),
		);
		const onUploaded = vi.fn();
		const onFailed = vi.fn();
		const { result } = renderHook(() =>
			useArticleImageUpload({ onUploaded, onFailed }),
		);

		const files = [
			makeFile("a.png"),
			makeFile("b.png"),
			makeFile("c.png"),
			makeFile("d.png"),
			makeFile("e.png"),
		];
		act(() => {
			result.current.enqueue(files);
		});

		// 並列上限 3 で running、 残り 2 件は queue
		await waitFor(() => {
			expect(requestImageUploadMock).toHaveBeenCalledTimes(3);
		});
		expect(result.current.rows).toHaveLength(5);
		expect(
			result.current.rows.filter((r) => r.state === "uploading"),
		).toHaveLength(3);
		expect(
			result.current.rows.filter((r) => r.state === "queued"),
		).toHaveLength(2);

		// 順に resolve しながら次の dispatch を待ち、 最終的に 5 件全部 done になる
		// (drainQueue は 1 件完了で 1 件 spawn する race-free な動作の確認)
		for (let i = 0; i < 5; i++) {
			await act(async () => {
				resolvers[i]?.();
			});
		}
		await waitFor(() => {
			expect(onUploaded).toHaveBeenCalledTimes(5);
		});
		expect(requestImageUploadMock).toHaveBeenCalledTimes(5);
	});
});
