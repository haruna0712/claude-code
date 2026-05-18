/**
 * #767: DraftsLoadDialog vitest。
 *
 * カバレッジ:
 * - DRAFTS-LOAD-DIALOG-1: open=true で fetchDrafts 呼ばれる、 一覧表示
 * - DRAFTS-LOAD-DIALOG-2: 0 件で「下書きはまだありません」
 * - DRAFTS-LOAD-DIALOG-3: 「編集」 click で onPick(draft) 呼ばれる
 * - DRAFTS-LOAD-DIALOG-4: 「削除」 confirm OK → deleteTweet 呼ばれる + 行消える
 * - DRAFTS-LOAD-DIALOG-5: 401 → 「ログインが必要です」 toast
 */

import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import DraftsLoadDialog from "@/components/tweets/DraftsLoadDialog";

const { fetchDraftsMock, deleteTweetMock, toastSuccessSpy, toastErrorSpy } =
	vi.hoisted(() => ({
		fetchDraftsMock: vi.fn(),
		deleteTweetMock: vi.fn(),
		toastSuccessSpy: vi.fn(),
		toastErrorSpy: vi.fn(),
	}));

vi.mock("@/lib/api/tweets", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/tweets")>(
			"@/lib/api/tweets",
		);
	return {
		...actual,
		fetchDrafts: fetchDraftsMock,
		deleteTweet: deleteTweetMock,
	};
});

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

const page = (results: ReturnType<typeof draft>[]) => ({
	count: results.length,
	next: null,
	previous: null,
	results,
});

describe("DraftsLoadDialog (#767)", () => {
	beforeEach(() => {
		fetchDraftsMock.mockReset();
		deleteTweetMock.mockReset();
		toastSuccessSpy.mockReset();
		toastErrorSpy.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("DRAFTS-LOAD-DIALOG-1: fetches drafts on open + renders list", async () => {
		fetchDraftsMock.mockResolvedValueOnce(
			page([draft(1, "first draft"), draft(2, "second draft")]),
		);

		render(
			<DraftsLoadDialog
				open={true}
				onOpenChange={() => {}}
				onPick={() => {}}
			/>,
		);

		await waitFor(() => expect(fetchDraftsMock).toHaveBeenCalledTimes(1));
		await waitFor(() =>
			expect(screen.getByText("first draft")).toBeInTheDocument(),
		);
		expect(screen.getByText("second draft")).toBeInTheDocument();
	});

	it("DRAFTS-LOAD-DIALOG-2: empty state when no drafts", async () => {
		fetchDraftsMock.mockResolvedValueOnce(page([]));

		render(
			<DraftsLoadDialog
				open={true}
				onOpenChange={() => {}}
				onPick={() => {}}
			/>,
		);

		await waitFor(() =>
			expect(screen.getByText("下書きはまだありません")).toBeInTheDocument(),
		);
	});

	it("DRAFTS-LOAD-DIALOG-3: edit click invokes onPick", async () => {
		const user = userEvent.setup();
		const onPick = vi.fn();
		fetchDraftsMock.mockResolvedValueOnce(page([draft(1, "pick me")]));

		render(
			<DraftsLoadDialog open={true} onOpenChange={() => {}} onPick={onPick} />,
		);

		const list = await screen.findByTestId("drafts-load-list");
		const editButton = within(list).getByRole("button", { name: /編集/ });
		await user.click(editButton);

		expect(onPick).toHaveBeenCalledTimes(1);
		expect(onPick.mock.calls[0][0]).toMatchObject({ id: 1, body: "pick me" });
	});

	it("DRAFTS-LOAD-DIALOG-4: delete with confirm removes row", async () => {
		const user = userEvent.setup();
		fetchDraftsMock.mockResolvedValueOnce(
			page([draft(1, "to delete"), draft(2, "keep me")]),
		);
		deleteTweetMock.mockResolvedValueOnce(undefined);
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

		render(
			<DraftsLoadDialog
				open={true}
				onOpenChange={() => {}}
				onPick={() => {}}
			/>,
		);

		const list = await screen.findByTestId("drafts-load-list");
		const deleteButtons = within(list).getAllByRole("button", {
			name: /削除する/,
		});
		await user.click(deleteButtons[0]);

		await waitFor(() => expect(deleteTweetMock).toHaveBeenCalledWith(1));
		expect(toastSuccessSpy).toHaveBeenCalledWith("下書きを削除しました");
		expect(screen.queryByText("to delete")).not.toBeInTheDocument();
		expect(screen.getByText("keep me")).toBeInTheDocument();
		confirmSpy.mockRestore();
	});

	it("DRAFTS-LOAD-DIALOG-5: 401 fetch shows auth toast", async () => {
		fetchDraftsMock.mockRejectedValueOnce(
			new AxiosError("unauth", "401", undefined, undefined, {
				status: 401,
				statusText: "Unauthorized",
				data: {},
				headers: {},
				config: { headers: new AxiosHeaders() },
			} as any),
		);

		render(
			<DraftsLoadDialog
				open={true}
				onOpenChange={() => {}}
				onPick={() => {}}
			/>,
		);

		await waitFor(() =>
			expect(toastErrorSpy).toHaveBeenCalledWith("ログインが必要です。"),
		);
	});
});
