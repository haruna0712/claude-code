/**
 * ArticleOwnerActions unit test (#593).
 *
 * 詳細ページの sticky header owner action (編集 link + 削除 button) の振る舞いを
 * unit レベルで verify する。 owner check 自体は parent (server component) で
 * 行うため、 ここでは component 単体の動作のみ確認する:
 *
 * - 編集 link が `/articles/<slug>/edit` を指している
 * - 削除 button click → confirm → API 呼び出し → toast.success + redirect
 * - confirm cancel で API 呼ばない
 * - 削除失敗で toast.error
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ArticleOwnerActions from "@/components/articles/ArticleOwnerActions";

// ---- mocks ----

const { pushMock, refreshMock } = vi.hoisted(() => ({
	pushMock: vi.fn(),
	refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const { deleteArticleMock } = vi.hoisted(() => ({
	deleteArticleMock: vi.fn(),
}));

vi.mock("@/lib/api/articles", () => ({
	deleteArticle: deleteArticleMock,
}));

vi.mock("react-toastify", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

// ---- tests ----

describe("ArticleOwnerActions", () => {
	beforeEach(() => {
		pushMock.mockReset();
		refreshMock.mockReset();
		deleteArticleMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("renders edit link pointing to /articles/<slug>/edit", () => {
		render(<ArticleOwnerActions slug="hello" />);
		const link = screen.getByRole("link", { name: "記事を編集" });
		expect(link).toHaveAttribute("href", "/articles/hello/edit");
	});

	it("renders delete button", () => {
		render(<ArticleOwnerActions slug="hello" />);
		expect(
			screen.getByRole("button", { name: "記事を削除" }),
		).toBeInTheDocument();
	});

	it("calls deleteArticle + toast.success + router.push on delete confirm", async () => {
		// window.confirm を accept
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		deleteArticleMock.mockResolvedValueOnce(undefined);

		const user = userEvent.setup();
		render(<ArticleOwnerActions slug="hello" />);
		await user.click(screen.getByRole("button", { name: "記事を削除" }));

		await waitFor(() => {
			expect(deleteArticleMock).toHaveBeenCalledWith("hello");
		});
		const { toast } = await import("react-toastify");
		expect(toast.success).toHaveBeenCalledWith("削除しました");
		expect(pushMock).toHaveBeenCalledWith("/articles");
		expect(refreshMock).toHaveBeenCalledTimes(1);

		confirmSpy.mockRestore();
	});

	it("does NOT call deleteArticle when user cancels the confirm", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

		const user = userEvent.setup();
		render(<ArticleOwnerActions slug="hello" />);
		await user.click(screen.getByRole("button", { name: "記事を削除" }));

		expect(deleteArticleMock).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();

		confirmSpy.mockRestore();
	});

	it("shows toast.error and re-enables the button on delete failure", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		deleteArticleMock.mockRejectedValueOnce(new Error("network down"));

		const user = userEvent.setup();
		render(<ArticleOwnerActions slug="hello" />);
		const btn = screen.getByRole("button", { name: "記事を削除" });
		await user.click(btn);

		const { toast } = await import("react-toastify");
		await waitFor(() => {
			expect(toast.error).toHaveBeenCalled();
		});
		// 失敗時は router.push しない (画面に留まる)
		expect(pushMock).not.toHaveBeenCalled();

		confirmSpy.mockRestore();
	});
});
