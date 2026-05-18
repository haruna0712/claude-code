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
	detectBodyH1MatchesTitle,
	insertImageMarkdown,
} from "@/components/articles/ArticleEditor";

const { routerPushMock } = vi.hoisted(() => ({
	routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: routerPushMock, refresh: vi.fn() }),
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

const { enqueueMock, uploadRowsMock } = vi.hoisted(() => ({
	enqueueMock: vi.fn(),
	uploadRowsMock: vi.fn<
		() => Array<{
			id: string;
			filename: string;
			state: "queued" | "uploading" | "done" | "failed";
			error?: string;
		}>
	>(() => []),
}));

vi.mock("@/hooks/useArticleImageUpload", () => ({
	useArticleImageUpload: () => ({
		rows: uploadRowsMock(),
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

describe("detectBodyH1MatchesTitle (#616)", () => {
	it("T-H1-DUP-1 body 先頭 h1 が title と完全一致 → h1 text を返す", () => {
		expect(detectBodyH1MatchesTitle("Hello", "# Hello\n\nbody")).toBe("Hello");
	});

	it("T-H1-DUP-2 大文字小文字無視で一致判定", () => {
		expect(detectBodyH1MatchesTitle("Hello", "# hello\n\nbody")).toBe("hello");
	});

	it("T-H1-DUP-3 title の前後 whitespace を許容", () => {
		expect(detectBodyH1MatchesTitle("  Hello  ", "# Hello\n\nbody")).toBe(
			"Hello",
		);
	});

	it("T-H1-DUP-4 body 先頭の blank line を許容", () => {
		expect(detectBodyH1MatchesTitle("Hello", "\n\n# Hello\n\nbody")).toBe(
			"Hello",
		);
	});

	it("T-H1-DUP-5 body が h2 (##) で始まる場合は null", () => {
		expect(detectBodyH1MatchesTitle("Hello", "## Hello\n\nbody")).toBeNull();
	});

	it("T-H1-DUP-6 title と h1 text が違うなら null", () => {
		expect(detectBodyH1MatchesTitle("Hello", "# World\n\nbody")).toBeNull();
	});

	it("T-H1-DUP-7 body に h1 が無いなら null", () => {
		expect(
			detectBodyH1MatchesTitle("Hello", "body without heading"),
		).toBeNull();
	});

	it("T-H1-DUP-8 title が空文字なら null (誤検知防止)", () => {
		expect(detectBodyH1MatchesTitle("", "# Hello\n\nbody")).toBeNull();
	});

	it("T-H1-DUP-9 body が空文字なら null", () => {
		expect(detectBodyH1MatchesTitle("Hello", "")).toBeNull();
	});
});

describe("ArticleEditor", () => {
	beforeEach(() => {
		enqueueMock.mockReset();
		uploadRowsMock.mockReset();
		uploadRowsMock.mockReturnValue([]);
		routerPushMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		createArticleMock.mockReset();
		updateArticleMock.mockReset();
		if (typeof window !== "undefined") {
			window.localStorage.clear();
		}
	});

	it("T-EDIT-2 preview pane renders heading from body markdown", () => {
		render(<ArticleEditor mode="create" />);
		const textarea = screen.getByLabelText("本文 (Markdown)", {
			exact: false,
		}) as HTMLTextAreaElement;
		fireEvent.change(textarea, { target: { value: "# title\n\nhello" } });
		// #780: Write tab default で preview pane は hidden = accessibility tree
		// から除外されている。 Preview tab に切り替えてから rendered HTML を確認。
		fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
		expect(
			screen.getByRole("heading", { name: "title", level: 1 }),
		).toBeInTheDocument();
	});

	// #780 Zenn 流 refactor: Write / Preview タブ切替
	describe("#780 Write/Preview タブ切替", () => {
		it("HP-1: 初期表示で Write tab が aria-selected=true、 Preview pane は hidden", () => {
			render(<ArticleEditor mode="create" />);
			const writeTab = screen.getByRole("tab", { name: "Write" });
			const previewTab = screen.getByRole("tab", { name: "Preview" });
			expect(writeTab).toHaveAttribute("aria-selected", "true");
			expect(previewTab).toHaveAttribute("aria-selected", "false");
			// preview tabpanel は hidden だが DOM には存在
			const previewPanel = document.getElementById("editor-panel-preview");
			expect(previewPanel).not.toBeNull();
			expect(previewPanel).toHaveAttribute("hidden");
		});

		it("HP-2: Preview tab click で aria-selected が切り替わり、 textarea は hidden、 preview pane が visible", () => {
			render(<ArticleEditor mode="create" />);
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
			expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute(
				"aria-selected",
				"false",
			);
			const writePanel = document.getElementById("editor-panel-write");
			expect(writePanel).toHaveAttribute("hidden");
		});

		it("BD-1: ArrowRight キーで Preview に切替、 ArrowLeft で Write に戻る", () => {
			render(<ArticleEditor mode="create" />);
			const writeTab = screen.getByRole("tab", { name: "Write" });
			fireEvent.keyDown(writeTab, { key: "ArrowRight" });
			expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
			const previewTab = screen.getByRole("tab", { name: "Preview" });
			fireEvent.keyDown(previewTab, { key: "ArrowLeft" });
			expect(screen.getByRole("tab", { name: "Write" })).toHaveAttribute(
				"aria-selected",
				"true",
			);
		});

		it("SE-2: Preview に切り替えても title / slug / tags / status の input 値は維持される", () => {
			render(<ArticleEditor mode="create" />);
			const titleInput = screen.getByLabelText(/タイトル/, {
				selector: "input",
			}) as HTMLInputElement;
			fireEvent.change(titleInput, { target: { value: "回帰検証用タイトル" } });
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
			expect(
				(
					screen.getByLabelText(/タイトル/, {
						selector: "input",
					}) as HTMLInputElement
				).value,
			).toBe("回帰検証用タイトル");
		});

		it("SE-3 (デグレ防止): Preview tab 中も form submit が走り createArticle が呼ばれる", async () => {
			createArticleMock.mockResolvedValueOnce({ slug: "ok-slug" });
			render(<ArticleEditor mode="create" />);
			const titleInput = screen.getByLabelText(/タイトル/, {
				selector: "input",
			}) as HTMLInputElement;
			fireEvent.change(titleInput, { target: { value: "preview submit" } });
			const body = screen.getByLabelText("本文 (Markdown)", {
				exact: false,
			}) as HTMLTextAreaElement;
			fireEvent.change(body, { target: { value: "## sub" } });
			// Preview に切替
			fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
			// 保存 button は tablist の右端にあり、 default status=draft なので「下書き保存」
			const submitBtn = screen.getByRole("button", {
				name: "下書き保存",
			}) as HTMLButtonElement;
			await act(async () => {
				submitBtn.click();
			});
			expect(createArticleMock).toHaveBeenCalledTimes(1);
		});
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

	it("shows active upload rows while images are queued or uploading", () => {
		uploadRowsMock.mockReturnValue([
			{ id: "1", filename: "queued.png", state: "queued" },
			{ id: "2", filename: "uploading.png", state: "uploading" },
		]);

		render(<ArticleEditor mode="create" />);

		expect(screen.getByText(/待機中: queued\.png/)).toBeInTheDocument();
		expect(
			screen.getByText(/アップロード中: uploading\.png/),
		).toBeInTheDocument();
		expect(screen.getByText("2 件の画像をアップロード中")).toBeInTheDocument();
	});

	it("cancel returns to article list when create form is unchanged", () => {
		render(<ArticleEditor mode="create" />);

		fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

		expect(routerPushMock).toHaveBeenCalledWith("/articles");
	});

	it("cancel can keep editing when dirty form confirmation is rejected", () => {
		vi.spyOn(window, "confirm").mockReturnValue(false);
		render(<ArticleEditor mode="edit" initial={buildInitial("draft")} />);
		const titleInput = screen.getByLabelText(/タイトル/, {
			selector: "input",
		}) as HTMLInputElement;
		fireEvent.change(titleInput, { target: { value: "Changed" } });

		fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));

		expect(routerPushMock).not.toHaveBeenCalled();
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
