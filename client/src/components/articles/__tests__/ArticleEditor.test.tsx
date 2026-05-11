/**
 * Tests for ArticleEditor (#536 / PR C で live preview + image D&D 追加).
 *
 * 検証:
 *   T-EDIT-1 insertImageMarkdown が caret 位置に ![alt](url) を挿入し前後改行を補完
 *   T-EDIT-2 preview pane が rendered HTML (heading) を表示
 *   T-EDIT-3 「画像を追加」 button click で file input が開く + 選択 file が enqueue される
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ArticleEditor, {
	insertImageMarkdown,
} from "@/components/articles/ArticleEditor";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("react-toastify", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

const { enqueueMock } = vi.hoisted(() => ({
	enqueueMock: vi.fn(),
}));

vi.mock("@/hooks/useArticleImageUpload", () => ({
	useArticleImageUpload: () => ({
		rows: [],
		enqueue: enqueueMock,
		clearFinished: vi.fn(),
	}),
}));

describe("insertImageMarkdown", () => {
	const image = {
		id: "x",
		s3_key: "k",
		url: "https://cdn.example.com/foo.png",
		width: 100,
		height: 100,
		size: 100,
	};

	it("T-EDIT-1 inserts ![alt](url) at caret with leading/trailing newline at mid-body", () => {
		const result = insertImageMarkdown("foo bar", 4, image, "foo.png");
		// caret=4 → "foo " と "bar" の境目。 前後改行が入る
		expect(result.next).toBe(
			"foo \n![foo.png](https://cdn.example.com/foo.png)\nbar",
		);
		expect(result.nextCaret).toBeGreaterThan(4);
	});

	it("T-EDIT-1b at empty body, no extra newlines", () => {
		const result = insertImageMarkdown("", 0, image, "foo.png");
		expect(result.next).toBe("![foo.png](https://cdn.example.com/foo.png)");
	});

	it("T-EDIT-1c at end of body, only leading newline", () => {
		const result = insertImageMarkdown("hello", 5, image, "foo.png");
		expect(result.next).toBe(
			"hello\n![foo.png](https://cdn.example.com/foo.png)",
		);
	});

	it("T-EDIT-1d caret beyond body length clamps to end", () => {
		const result = insertImageMarkdown("abc", 999, image, "x.png");
		expect(result.next).toBe("abc\n![x.png](https://cdn.example.com/foo.png)");
	});

	it("T-EDIT-1e filename with ] and \\ is sanitized for alt", () => {
		const result = insertImageMarkdown("", 0, image, "[shot].png");
		// `[` `\` `]` のうち `]` と `\` だけが除去される (`[` は alt text 内で許可)
		expect(result.next).toBe("![[shot.png](https://cdn.example.com/foo.png)");
	});
});

describe("ArticleEditor", () => {
	beforeEach(() => {
		enqueueMock.mockReset();
	});

	it("T-EDIT-2 preview pane renders heading from body markdown", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen
			.getByLabelText("本文 (Markdown)", {
				exact: false,
			})
			.matches?.("textarea")
			? screen.getByLabelText("本文 (Markdown)", { exact: false })
			: (screen
					.getAllByRole("textbox")
					.find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement);

		fireEvent.change(textarea, { target: { value: "# title\n\nhello" } });
		// preview pane に <h1>title</h1> が render
		expect(
			screen.getByRole("heading", { name: "title", level: 1 }),
		).toBeInTheDocument();
	});

	it("T-EDIT-3 file picker via 「画像を追加」 button enqueues selected files", () => {
		render(<ArticleEditor mode="create" />);
		const btn = screen.getByRole("button", { name: "画像を追加" });

		// button の隣に hidden file input がある (next sibling)
		const fileInput = btn.parentElement?.querySelector(
			'input[type="file"]',
		) as HTMLInputElement | null;
		expect(fileInput).not.toBeNull();

		const file = new File(["x"], "shot.png", { type: "image/png" });
		fireEvent.change(fileInput!, { target: { files: [file] } });
		expect(enqueueMock).toHaveBeenCalledTimes(1);
		expect(enqueueMock).toHaveBeenCalledWith([file]);
	});
});
