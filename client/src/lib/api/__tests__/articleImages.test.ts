/**
 * Tests for articleImages (#536 / PR C、 code-reviewer H-1 反映).
 *
 * useArticleImageUpload.test.tsx では requestImageUpload を mock していて
 * 中身の validate / extractApiMessage は 0% カバレッジだった。 ここで直接叩く。
 */

import { describe, expect, it } from "vitest";

import {
	ArticleImageUploadError,
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
