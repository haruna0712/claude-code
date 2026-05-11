/**
 * Tests for articleImages (#536 / PR C、 code-reviewer H-1 反映).
 *
 * useArticleImageUpload.test.tsx では requestImageUpload を mock していて
 * 中身の validate / extractApiMessage は 0% カバレッジだった。 ここで直接叩く。
 */

import { describe, expect, it } from "vitest";

import {
	ArticleImageUploadError,
	extractApiMessage,
	guessExtension,
	validateImageFile,
} from "@/lib/api/articleImages";

function makeFile(name: string, type: string, size: number): File {
	const file = new File(["x".repeat(size)], name, { type });
	if (file.size !== size) {
		Object.defineProperty(file, "size", { value: size });
	}
	return file;
}

describe("validateImageFile", () => {
	it("OK: image/png 1KB", () => {
		// 例外を投げないことだけ確認 (副作用なし)
		validateImageFile(makeFile("a.png", "image/png", 1024));
	});

	it("OK: image/jpeg / webp / gif", () => {
		validateImageFile(makeFile("a.jpg", "image/jpeg", 1024));
		validateImageFile(makeFile("a.webp", "image/webp", 1024));
		validateImageFile(makeFile("a.gif", "image/gif", 1024));
	});

	it("NG: unsupported mime", () => {
		expect(() =>
			validateImageFile(makeFile("a.pdf", "application/pdf", 1024)),
		).toThrow(ArticleImageUploadError);
	});

	it("NG: empty file (size=0)", () => {
		// jsdom の File は constructor の blob parts から size を引くので、
		// 強制的に 0 に設定する
		const f = makeFile("a.png", "image/png", 1);
		Object.defineProperty(f, "size", { value: 0 });
		expect(() => validateImageFile(f)).toThrow(ArticleImageUploadError);
	});

	it("NG: size > 5 MiB", () => {
		expect(() =>
			validateImageFile(makeFile("a.png", "image/png", 5 * 1024 * 1024 + 1)),
		).toThrow(ArticleImageUploadError);
	});

	it("ArticleImageUploadError carries step name", () => {
		try {
			validateImageFile(makeFile("a.pdf", "application/pdf", 1024));
		} catch (err) {
			expect(err).toBeInstanceOf(ArticleImageUploadError);
			if (err instanceof ArticleImageUploadError) {
				expect(err.step).toBe("validate");
				expect(err.message).toContain("application/pdf");
			}
		}
	});
});

describe("ArticleImageUploadError", () => {
	it("name is set to 'ArticleImageUploadError'", () => {
		const e = new ArticleImageUploadError("msg", "presign");
		expect(e.name).toBe("ArticleImageUploadError");
		expect(e.message).toBe("msg");
		expect(e.step).toBe("presign");
		expect(e).toBeInstanceOf(Error);
	});
});

describe("guessExtension", () => {
	it("maps each allowed mime to its canonical extension", () => {
		expect(guessExtension("image/jpeg")).toBe("jpg");
		expect(guessExtension("image/png")).toBe("png");
		expect(guessExtension("image/webp")).toBe("webp");
		expect(guessExtension("image/gif")).toBe("gif");
	});

	it("falls back to 'bin' for unknown mime", () => {
		expect(guessExtension("application/octet-stream")).toBe("bin");
		expect(guessExtension("")).toBe("bin");
	});
});

describe("extractApiMessage", () => {
	it("returns axios response.data.detail when present", () => {
		const err = { response: { data: { detail: "bad request" } } };
		expect(extractApiMessage(err, "fallback")).toBe("bad request");
	});

	it("returns first element when first field is an array of strings", () => {
		const err = { response: { data: { mime_type: ["unsupported"] } } };
		expect(extractApiMessage(err, "fallback")).toBe("unsupported");
	});

	it("returns Error.message when no response shape", () => {
		const err = new Error("network down");
		expect(extractApiMessage(err, "fallback")).toBe("network down");
	});

	it("returns fallback for unknown shapes", () => {
		expect(extractApiMessage(null, "fallback")).toBe("fallback");
		expect(extractApiMessage(undefined, "fallback")).toBe("fallback");
		expect(extractApiMessage(42, "fallback")).toBe("fallback");
	});
});
