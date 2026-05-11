/**
 * Tests for ArticleEditor (#536 / PR C で live preview + image D&D 追加).
 *
 * 検証:
 *   T-EDIT-1 insertImageMarkdown が caret 位置に ![alt](url) を挿入し前後改行を補完
 *   T-EDIT-2 preview pane が rendered HTML (heading) を表示
 *   T-EDIT-3 「画像を追加」 button click で file input が開く + 選択 file が enqueue される
 *   T-PUBLISH-1..4 (#607) handleSubmit 成功時に toast が出る (create/update × draft/published)
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ArticleEditor, {
	insertImageMarkdown,
} from "@/components/articles/ArticleEditor";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
	toastSuccessMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessMock, error: toastErrorMock },
}));

const { createArticleMock, updateArticleMock } = vi.hoisted(() => ({
	createArticleMock: vi.fn(),
	updateArticleMock: vi.fn(),
}));

vi.mock("@/lib/api/articles", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/articles")>(
			"@/lib/api/articles",
		);
	return {
		...actual,
		createArticle: createArticleMock,
		updateArticle: updateArticleMock,
	};
});

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

	it("T-EDIT-1e filename with [ ] \\ are all stripped from alt", () => {
		const result = insertImageMarkdown("", 0, image, "[shot].png");
		// typescript-reviewer H-1 反映: [/]/\\ を全て除去して malformed markdown
		// (`![[shot.png](url)`) にならないようにする。
		expect(result.next).toBe("![shot.png](https://cdn.example.com/foo.png)");
	});
});

describe("ArticleEditor", () => {
	beforeEach(() => {
		enqueueMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		createArticleMock.mockReset();
		updateArticleMock.mockReset();
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
		const { container } = render(<ArticleEditor mode="create" />);
		expect(
			screen.getByRole("button", { name: "画像を追加" }),
		).toBeInTheDocument();

		// hidden file input は role を持たないので container 経由で直接取る
		// (typescript-reviewer LOW-4 反映: DOM walk 経由ではなく selector で取得)。
		const fileInput = container.querySelector(
			'input[type="file"][accept*="image"]',
		) as HTMLInputElement | null;
		expect(fileInput).not.toBeNull();

		const file = new File(["x"], "shot.png", { type: "image/png" });
		fireEvent.change(fileInput!, { target: { files: [file] } });
		expect(enqueueMock).toHaveBeenCalledTimes(1);
		expect(enqueueMock).toHaveBeenCalledWith([file]);
	});

	it("T-EDIT-4 paste with image file → enqueue + preventDefault (code-reviewer M-3)", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen.getByLabelText(/本文/, {
			selector: "textarea",
		}) as HTMLTextAreaElement;

		const imageFile = new File(["x"], "pasted.png", { type: "image/png" });
		const clipboardData = {
			items: [
				{
					kind: "file",
					type: "image/png",
					getAsFile: () => imageFile,
				},
			],
		};
		fireEvent.paste(textarea, { clipboardData });
		expect(enqueueMock).toHaveBeenCalledTimes(1);
		expect(enqueueMock).toHaveBeenCalledWith([imageFile]);
	});

	it("T-EDIT-5 paste with non-image (text) does NOT enqueue (code-reviewer M-3)", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen.getByLabelText(/本文/, {
			selector: "textarea",
		}) as HTMLTextAreaElement;

		const clipboardData = {
			items: [
				{
					kind: "string",
					type: "text/plain",
					getAsFile: () => null,
				},
			],
		};
		fireEvent.paste(textarea, { clipboardData });
		expect(enqueueMock).not.toHaveBeenCalled();
	});

	it("T-EDIT-6 drop with image file → enqueue + preventDefault (code-reviewer M-3)", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen.getByLabelText(/本文/, {
			selector: "textarea",
		}) as HTMLTextAreaElement;

		const imageFile = new File(["x"], "dropped.png", { type: "image/png" });
		fireEvent.drop(textarea, {
			dataTransfer: { files: [imageFile], types: ["Files"] },
		});
		expect(enqueueMock).toHaveBeenCalledTimes(1);
		expect(enqueueMock).toHaveBeenCalledWith([imageFile]);
	});

	it("T-EDIT-7 drop with non-image (text/html) does NOT enqueue", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen.getByLabelText(/本文/, {
			selector: "textarea",
		}) as HTMLTextAreaElement;

		fireEvent.drop(textarea, {
			dataTransfer: { files: [], types: ["text/html"] },
		});
		expect(enqueueMock).not.toHaveBeenCalled();
	});

	// #607: handleSubmit success path toast (gan-evaluator M1)。
	// confirm dialog (status=published) は jsdom で auto-deny されるので status=draft で
	// path をカバー + window.confirm を mock で auto-accept した published path も検証。
	const fillForm = () => {
		const titleInput = screen.getByLabelText(/タイトル/, {
			selector: "input",
		}) as HTMLInputElement;
		const bodyInput = screen.getByLabelText(/本文/, {
			selector: "textarea",
		}) as HTMLTextAreaElement;
		fireEvent.change(titleInput, { target: { value: "Hello" } });
		fireEvent.change(bodyInput, { target: { value: "Hello body" } });
	};

	type EditableArticle = {
		id: string;
		slug: string;
		title: string;
		body_markdown: string;
		body_html: string;
		status: "draft" | "published";
		published_at: string | null;
		view_count: number;
		author: { handle: string; display_name: string; avatar_url: string };
		tags: { slug: string; display_name: string }[];
		like_count: number;
		comment_count: number;
		created_at: string;
		updated_at: string;
	};
	const buildInitial = (status: "draft" | "published"): EditableArticle => ({
		id: "1",
		slug: "hello",
		title: "Hello",
		body_markdown: "body",
		body_html: "<p>body</p>",
		status,
		published_at: status === "published" ? "2026-01-01T00:00:00Z" : null,
		view_count: 0,
		author: { handle: "u", display_name: "U", avatar_url: "" },
		tags: [],
		like_count: 0,
		comment_count: 0,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
	});

	const submitButton = (name: string) =>
		screen.getByRole("button", { name }) as HTMLButtonElement;

	it("T-PUBLISH-1 create + draft で「下書きを保存しました」 toast", async () => {
		createArticleMock.mockResolvedValueOnce({ slug: "hello" });
		render(<ArticleEditor mode="create" />);
		fillForm();
		await act(async () => {
			fireEvent.click(submitButton("下書き保存"));
		});
		expect(createArticleMock).toHaveBeenCalledTimes(1);
		expect(toastSuccessMock).toHaveBeenCalledWith("下書きを保存しました");
	});

	it("T-PUBLISH-2 create + published で「公開しました」 toast", async () => {
		createArticleMock.mockResolvedValueOnce({ slug: "hello" });
		vi.spyOn(window, "confirm").mockReturnValue(true);
		render(<ArticleEditor mode="create" />);
		fillForm();
		const publishRadio = screen.getByLabelText("公開") as HTMLInputElement;
		fireEvent.click(publishRadio);
		await act(async () => {
			fireEvent.click(submitButton("公開する"));
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("公開しました");
	});

	it("T-PUBLISH-3 edit + draft で「下書きを保存しました」 toast", async () => {
		updateArticleMock.mockResolvedValueOnce({ slug: "hello" });
		render(<ArticleEditor mode="edit" initial={buildInitial("draft")} />);
		await act(async () => {
			fireEvent.click(submitButton("更新"));
		});
		expect(updateArticleMock).toHaveBeenCalledTimes(1);
		expect(toastSuccessMock).toHaveBeenCalledWith("下書きを保存しました");
	});

	it("T-PUBLISH-4 edit + published で「公開しました」 toast", async () => {
		updateArticleMock.mockResolvedValueOnce({ slug: "hello" });
		vi.spyOn(window, "confirm").mockReturnValue(true);
		render(<ArticleEditor mode="edit" initial={buildInitial("published")} />);
		await act(async () => {
			fireEvent.click(submitButton("更新して公開"));
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("公開しました");
	});
});
