/**
 * Tests for AddToFolderDialog (#499).
 *
 * docs/specs/favorites-spec.md §5.3 を満たす:
 * - 自分の folder 一覧をフラット表示 (parent でインデント)
 * - 既保存 folder の checkbox は ON
 * - toggle で createBookmark / deleteBookmark を呼ぶ
 * - 新規 folder 作成は createFolder を呼んで一覧へ即時反映
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AddToFolderDialog from "@/components/boxes/AddToFolderDialog";
import * as boxesApi from "@/lib/api/boxes";

vi.mock("@/lib/api/boxes", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/boxes")>("@/lib/api/boxes");
	return {
		...actual,
		listFolders: vi.fn(),
		getTweetBookmarkStatus: vi.fn(),
		createBookmark: vi.fn(),
		deleteBookmark: vi.fn(),
		createFolder: vi.fn(),
	};
});

const NOW = "2026-05-10T00:00:00Z";

beforeEach(() => {
	vi.resetAllMocks();
});

describe("AddToFolderDialog", () => {
	it("一覧を取得して、保存済 folder には checkbox ON で表示する", async () => {
		vi.mocked(boxesApi.listFolders).mockResolvedValue([
			{
				id: 1,
				name: "技術",
				parent_id: null,
				bookmark_count: 2,
				child_count: 1,
				created_at: NOW,
				updated_at: NOW,
			},
			{
				id: 2,
				name: "Django",
				parent_id: 1,
				bookmark_count: 1,
				child_count: 0,
				created_at: NOW,
				updated_at: NOW,
			},
		]);
		// #503 status endpoint で folder_id → bookmark_id の dict を 1 query で取得。
		vi.mocked(boxesApi.getTweetBookmarkStatus).mockResolvedValue({
			folder_ids: [2],
			bookmark_ids: { "2": 99 },
		});

		render(
			<AddToFolderDialog tweetId={42} open onOpenChange={() => undefined} />,
		);

		const list = await screen.findByRole("list", {
			name: "お気に入りフォルダ",
		});
		const checkboxes = within(list).getAllByRole("checkbox");
		expect(checkboxes).toHaveLength(2);
		const djangoRow = within(list).getByText("Django").closest("label");
		expect(djangoRow).not.toBeNull();
		expect(within(djangoRow!).getByRole("checkbox")).toBeChecked();
		const techRow = within(list).getByText("技術").closest("label");
		expect(within(techRow!).getByRole("checkbox")).not.toBeChecked();
	});

	it("未保存 folder の checkbox を ON にすると createBookmark が呼ばれる", async () => {
		vi.mocked(boxesApi.listFolders).mockResolvedValue([
			{
				id: 1,
				name: "技術",
				parent_id: null,
				bookmark_count: 0,
				child_count: 0,
				created_at: NOW,
				updated_at: NOW,
			},
		]);
		vi.mocked(boxesApi.getTweetBookmarkStatus).mockResolvedValue({
			folder_ids: [],
			bookmark_ids: {},
		});
		vi.mocked(boxesApi.createBookmark).mockResolvedValue({
			bookmark: { id: 11, tweet_id: 42, folder_id: 1, created_at: NOW },
			created: true,
		});

		const onStatus = vi.fn();
		render(
			<AddToFolderDialog
				tweetId={42}
				open
				onOpenChange={() => undefined}
				onStatusChanged={onStatus}
			/>,
		);

		const checkbox = await screen.findByRole("checkbox");
		await userEvent.click(checkbox);

		await waitFor(() =>
			expect(boxesApi.createBookmark).toHaveBeenCalledWith({
				folder_id: 1,
				tweet_id: 42,
			}),
		);
		await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith([1]));
	});

	it("保存済 folder の checkbox を OFF にすると deleteBookmark が呼ばれる", async () => {
		vi.mocked(boxesApi.listFolders).mockResolvedValue([
			{
				id: 1,
				name: "技術",
				parent_id: null,
				bookmark_count: 1,
				child_count: 0,
				created_at: NOW,
				updated_at: NOW,
			},
		]);
		vi.mocked(boxesApi.getTweetBookmarkStatus).mockResolvedValue({
			folder_ids: [1],
			bookmark_ids: { "1": 99 },
		});
		vi.mocked(boxesApi.deleteBookmark).mockResolvedValue();

		render(
			<AddToFolderDialog tweetId={42} open onOpenChange={() => undefined} />,
		);

		const checkbox = await screen.findByRole("checkbox");
		await waitFor(() => expect(checkbox).toBeChecked());
		await userEvent.click(checkbox);

		await waitFor(() =>
			expect(boxesApi.deleteBookmark).toHaveBeenCalledWith(99),
		);
	});

	it("空名で submit するとエラー表示 (API 呼ばない)", async () => {
		vi.mocked(boxesApi.listFolders).mockResolvedValue([]);
		vi.mocked(boxesApi.getTweetBookmarkStatus).mockResolvedValue({
			folder_ids: [],
			bookmark_ids: {},
		});

		render(
			<AddToFolderDialog tweetId={42} open onOpenChange={() => undefined} />,
		);

		await screen.findByText(/まだフォルダがありません/);
		const submit = screen.getByRole("button", {
			name: /\+ フォルダを作成/,
		});
		// disabled が外れるのを待たず、空のままでは disabled
		expect(submit).toBeDisabled();
		expect(boxesApi.createFolder).not.toHaveBeenCalled();
	});

	it("新規フォルダ作成成功時に list へ追加される", async () => {
		vi.mocked(boxesApi.listFolders).mockResolvedValue([]);
		vi.mocked(boxesApi.getTweetBookmarkStatus).mockResolvedValue({
			folder_ids: [],
			bookmark_ids: {},
		});
		vi.mocked(boxesApi.createFolder).mockResolvedValue({
			id: 5,
			name: "新規",
			parent_id: null,
			bookmark_count: 0,
			child_count: 0,
			created_at: NOW,
			updated_at: NOW,
		});

		render(
			<AddToFolderDialog tweetId={42} open onOpenChange={() => undefined} />,
		);

		await screen.findByText(/まだフォルダがありません/);
		await userEvent.type(screen.getByPlaceholderText(/例:/), "新規");
		await userEvent.click(
			screen.getByRole("button", { name: /\+ フォルダを作成/ }),
		);

		await waitFor(() =>
			expect(boxesApi.createFolder).toHaveBeenCalledWith({
				name: "新規",
				parent_id: null,
			}),
		);
		const list = await screen.findByRole("list", {
			name: "お気に入りフォルダ",
		});
		expect(within(list).getByText("新規")).toBeInTheDocument();
	});
});
