/**
 * imageDimensions util のテスト (Issue #461).
 *
 * jsdom には Image / URL.createObjectURL があるが、Image.onload は src セット時に
 * 自動 fire しない (本物の image データは load しない)。ここでは Image を手動 mock
 * して onload/onerror を起動するパスを exercise する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { measureImageDimensions } from "@/lib/dm/imageDimensions";

interface MockImageInstance {
	naturalWidth: number;
	naturalHeight: number;
	onload: (() => void) | null;
	onerror: (() => void) | null;
	src: string;
}

let lastInstance: MockImageInstance | null = null;

function makeMockImage(): MockImageInstance {
	const inst: MockImageInstance = {
		naturalWidth: 0,
		naturalHeight: 0,
		onload: null,
		onerror: null,
		src: "",
	};
	let savedSrc = "";
	Object.defineProperty(inst, "src", {
		get(): string {
			return savedSrc;
		},
		set(v: string) {
			savedSrc = v;
			queueMicrotask(() => {
				lastInstance = inst;
			});
		},
	});
	return inst;
}

const createObjectURLMock = vi.fn(() => "blob:mock-url");
const revokeObjectURLMock = vi.fn();

describe("measureImageDimensions", () => {
	const originalImage = globalThis.Image;
	const originalCreate = URL.createObjectURL;
	const originalRevoke = URL.revokeObjectURL;

	beforeEach(() => {
		// Image() ctor → makeMockImage() の instance を返す。
		(globalThis as unknown as { Image: unknown }).Image = function () {
			return makeMockImage();
		};
		URL.createObjectURL = createObjectURLMock as typeof URL.createObjectURL;
		URL.revokeObjectURL = revokeObjectURLMock as typeof URL.revokeObjectURL;
		createObjectURLMock.mockClear();
		revokeObjectURLMock.mockClear();
		lastInstance = null;
	});

	afterEach(() => {
		globalThis.Image = originalImage;
		URL.createObjectURL = originalCreate;
		URL.revokeObjectURL = originalRevoke;
	});

	it("non-image MIME で null", async () => {
		const file = new File(["x"], "doc.pdf", { type: "application/pdf" });
		const result = await measureImageDimensions(file);
		expect(result).toBeNull();
		expect(createObjectURLMock).not.toHaveBeenCalled();
	});

	it("image で onload 経由 width/height が返る", async () => {
		const file = new File(["x"], "a.png", { type: "image/png" });
		const promise = measureImageDimensions(file);
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
		const img = lastInstance;
		expect(img).not.toBeNull();
		if (!img) throw new Error("no image instance");
		img.naturalWidth = 1296;
		img.naturalHeight = 952;
		img.onload?.();
		const result = await promise;
		expect(result).toEqual({ width: 1296, height: 952 });
		expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
	});

	it("壊れた image (onerror) で null", async () => {
		const file = new File(["x"], "broken.jpg", { type: "image/jpeg" });
		const promise = measureImageDimensions(file);
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
		const img = lastInstance;
		if (!img) throw new Error("no image instance");
		img.onerror?.();
		const result = await promise;
		expect(result).toBeNull();
		expect(revokeObjectURLMock).toHaveBeenCalled();
	});

	it("timeout で null", async () => {
		vi.useFakeTimers();
		const file = new File(["x"], "slow.png", { type: "image/png" });
		const promise = measureImageDimensions(file, 50);
		await Promise.resolve(); // microtask
		vi.advanceTimersByTime(60);
		const result = await promise;
		expect(result).toBeNull();
		expect(revokeObjectURLMock).toHaveBeenCalled();
		vi.useRealTimers();
	});
});
