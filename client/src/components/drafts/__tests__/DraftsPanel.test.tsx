/**
 * #734: DraftsPanel vitest。
 *
 * カバレッジ:
 * 1. empty state: 0 件で「下書きはまだありません」 が出る
 * 2. 一覧 render: initial に渡した tweets が出る
 * 3. 公開する click → publishDraft 呼び出し + 行が消える + 成功 toast
 * 4. 削除 click → confirm() OK → deleteTweet 呼び出し + 行が消える
 * 5. 404 公開エラー → 「下書きが見つかりません」 toast
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DraftsPanel from "@/components/drafts/DraftsPanel";

const {
	publishDraftMock,
	deleteTweetMock,
	toastSuccessSpy,
	toastErrorSpy,
	refreshMock,
} = vi.hoisted(() => ({
	publishDraftMock: vi.fn(),
	deleteTweetMock: vi.fn(),
	toastSuccessSpy: vi.fn(),
	toastErrorSpy: vi.fn(),
	refreshMock: vi.fn(),
}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return {
		...actual,
		publishDraft: publishDraftMock,
		deleteTweet: deleteTweetMock,
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: toastErrorSpy },
}));

const draft = (id: number, body: string) => ({
	id,
	body,
	html: body,
	char_count: body.length,
	author_handle: "alice",
	tags: [],
	images: [],
	created_at: "2026-05-14T00:00:00Z",
	updated_at: "2026-05-14T00:00:00Z",
	edit_count: 0,
	published_at: null,
});

describe("DraftsPanel (#734)", () => {
	beforeEach(() => {
		publishDraftMock.mockReset();
		deleteTweetMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
		refreshMock.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("shows empty state when no drafts", () => {
		render(<DraftsPanel initial={[]} />);
		expect(screen.getByText("下書きはまだありません。")).toBeInTheDocument();
	});

	it("renders drafts list", () => {
		render(
			<DraftsPanel
				initial={[draft(1, "first draft"), draft(2, "second draft")]}
			/>,
		);
		expect(screen.getByText("first draft")).toBeInTheDocument();
		expect(screen.getByText("second draft")).toBeInTheDocument();
	});

	it("publishes a draft → row disappears + success toast", async () => {
		publishDraftMock.mockResolvedValueOnce({
			...draft(1, "ready"),
			published_at: "2026-05-14T01:00:00Z",
		});
		render(<DraftsPanel initial={[draft(1, "ready")]} />);

		const publishBtn = screen.getByRole("button", {
			name: "下書きを公開する",
		});
		await userEvent.click(publishBtn);

		await waitFor(() => {
			expect(publishDraftMock).toHaveBeenCalledWith(1);
		});
		expect(toastSuccessSpy).toHaveBeenCalledWith("公開しました");
		// 行が消えて empty state になる
		await waitFor(() => {
			expect(screen.queryByText("ready")).not.toBeInTheDocument();
		});
	});

	it("deletes a draft after confirm → row disappears", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		deleteTweetMock.mockResolvedValueOnce(undefined);
		render(<DraftsPanel initial={[draft(2, "to delete")]} />);

		await userEvent.click(
			screen.getByRole("button", { name: "下書きを削除する" }),
		);

		await waitFor(() => {
			expect(deleteTweetMock).toHaveBeenCalledWith(2);
		});
		expect(toastSuccessSpy).toHaveBeenCalledWith("削除しました");
		await waitFor(() => {
			expect(screen.queryByText("to delete")).not.toBeInTheDocument();
		});
		confirmSpy.mockRestore();
	});

	it("shows 404 toast when publish fails with 404", async () => {
		const err = new AxiosError("not found");
		err.response = {
			status: 404,
			statusText: "Not Found",
			data: {},
			headers: {},
			config: { headers: new AxiosHeaders() },
		};
		publishDraftMock.mockRejectedValueOnce(err);
		render(<DraftsPanel initial={[draft(3, "ghost")]} />);

		await userEvent.click(
			screen.getByRole("button", { name: "下書きを公開する" }),
		);

		await waitFor(() => {
			expect(toastErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("見つかりません"),
			);
		});
	});
});
