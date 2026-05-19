/**
 * OccupationChipPicker tests (Phase 12 P12-06b, issue #818).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OccupationChipPicker from "@/components/profile/OccupationChipPicker";
import type { Occupation } from "@/lib/api/occupation";

const { saveMock, toastSuccessSpy } = vi.hoisted(() => ({
	saveMock: vi.fn(),
	toastSuccessSpy: vi.fn(),
}));

vi.mock("@/lib/api/occupation", async () => {
	const actual = await vi.importActual<typeof import("@/lib/api/occupation")>(
		"@/lib/api/occupation",
	);
	return {
		...actual,
		saveMyOccupations: saveMock,
	};
});

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: vi.fn() },
}));

const CATALOG: Occupation[] = [
	{ slug: "designer", display_name: "デザイナー", display_order: 10 },
	{
		slug: "frontend",
		display_name: "フロントエンドエンジニア",
		display_order: 20,
	},
	{
		slug: "backend",
		display_name: "バックエンドエンジニア",
		display_order: 30,
	},
	{
		slug: "fullstack",
		display_name: "フルスタックエンジニア",
		display_order: 40,
	},
];

function chip(label: string) {
	return screen.getByRole("switch", { name: label });
}

describe("OccupationChipPicker", () => {
	beforeEach(() => {
		saveMock.mockReset();
		toastSuccessSpy.mockReset();
	});

	it("renders every catalog occupation as a switch chip", () => {
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={[]}
			/>,
		);
		expect(screen.getAllByRole("switch")).toHaveLength(CATALOG.length);
		expect(chip("デザイナー")).toHaveAttribute("aria-checked", "false");
	});

	it("reflects initial selected slugs as aria-checked=true", () => {
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={["designer", "frontend"]}
			/>,
		);
		expect(chip("デザイナー")).toHaveAttribute("aria-checked", "true");
		expect(chip("フロントエンドエンジニア")).toHaveAttribute(
			"aria-checked",
			"true",
		);
		expect(chip("バックエンドエンジニア")).toHaveAttribute(
			"aria-checked",
			"false",
		);
	});

	it("toggles a chip and updates the count indicator", async () => {
		const user = userEvent.setup();
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={[]}
			/>,
		);
		await user.click(chip("デザイナー"));
		expect(chip("デザイナー")).toHaveAttribute("aria-checked", "true");
		expect(screen.getByTestId("occupation-count")).toHaveTextContent(
			"1 / 3 件選択中",
		);
	});

	it("disables unselected chips when 3 chips are selected", async () => {
		const user = userEvent.setup();
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={["designer", "frontend", "backend"]}
			/>,
		);
		// 4 件目 (fullstack) は disabled
		expect(chip("フルスタックエンジニア")).toBeDisabled();
		// 既選択は disable しない (off にできる必要)
		expect(chip("デザイナー")).not.toBeDisabled();
		// click しても aria-checked 変わらない
		await user.click(chip("フルスタックエンジニア"));
		expect(chip("フルスタックエンジニア")).toHaveAttribute(
			"aria-checked",
			"false",
		);
		expect(screen.getByTestId("occupation-limit-hint")).toBeInTheDocument();
	});

	it("save button is disabled when nothing changed", () => {
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={["designer"]}
			/>,
		);
		expect(screen.getByRole("button", { name: "職業を保存" })).toBeDisabled();
	});

	it("calls saveMyOccupations on save and shows success toast", async () => {
		const user = userEvent.setup();
		saveMock.mockResolvedValueOnce(["designer", "frontend"]);
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={[]}
			/>,
		);

		await user.click(chip("デザイナー"));
		await user.click(chip("フロントエンドエンジニア"));
		await user.click(screen.getByRole("button", { name: "職業を保存" }));

		expect(saveMock).toHaveBeenCalledWith(
			expect.arrayContaining(["designer", "frontend"]),
		);
		expect(toastSuccessSpy).toHaveBeenCalledWith("職業を保存しました");
		// 保存後は dirty=false で button 再 disable
		expect(screen.getByRole("button", { name: "職業を保存" })).toBeDisabled();
	});

	it("shows an error message when save fails", async () => {
		const user = userEvent.setup();
		saveMock.mockRejectedValueOnce(new Error("保存に失敗しました。"));
		render(
			<OccupationChipPicker
				allOccupations={CATALOG}
				initialSelectedSlugs={[]}
			/>,
		);
		await user.click(chip("デザイナー"));
		await user.click(screen.getByRole("button", { name: "職業を保存" }));

		const alert = await screen.findByRole("alert");
		expect(alert).toHaveTextContent("保存に失敗しました");
		expect(toastSuccessSpy).not.toHaveBeenCalled();
	});

	it("renders an empty-state message when catalog is empty", () => {
		render(
			<OccupationChipPicker allOccupations={[]} initialSelectedSlugs={[]} />,
		);
		expect(screen.queryAllByRole("switch")).toHaveLength(0);
		expect(
			screen.getByText(/catalog を取得できませんでした/),
		).toBeInTheDocument();
	});
});
