/**
 * P13-04: ProfileEditForm の言語 select + auto_translate toggle テスト。
 *
 * spec: docs/specs/auto-translate-spec.md §4.2 §7.2 §8.1
 *
 * カバレッジ:
 * 1. 言語 select を切り替えて submit すると updateCurrentUser に
 *    preferred_language が渡る
 * 2. 自動翻訳 toggle を ON にして submit すると auto_translate=true が渡る
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProfileEditForm from "@/components/profile/ProfileEditForm";
import type { CurrentUser } from "@/lib/api/users";

const { updateMock, pushMock, refreshMock, toastSuccessSpy } = vi.hoisted(
	() => ({
		updateMock: vi.fn(),
		pushMock: vi.fn(),
		refreshMock: vi.fn(),
		toastSuccessSpy: vi.fn(),
	}),
);

vi.mock("@/lib/api/users", async () => {
	const actual =
		await vi.importActual<typeof import("@/lib/api/users")>("@/lib/api/users");
	return {
		...actual,
		updateCurrentUser: updateMock,
	};
});

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("react-toastify", () => ({
	toast: { success: toastSuccessSpy, error: vi.fn() },
}));

// ImageCropper は presigned URL 取得 + S3 PUT を行うので test 内で stub。
vi.mock("@/components/shared/ImageCropper", () => ({
	default: () => null,
}));

const BASE_USER: CurrentUser = {
	id: "uuid-1",
	email: "tester@example.com",
	username: "tester",
	full_name: "Tester One",
	display_name: "Tester One",
	bio: "",
	avatar_url: "",
	header_url: "",
	is_premium: false,
	needs_onboarding: false,
	github_url: "",
	x_url: "",
	zenn_url: "",
	qiita_url: "",
	note_url: "",
	linkedin_url: "",
	preferred_language: "ja",
	auto_translate: false,
	is_private: false,
	date_joined: "2026-01-01T00:00:00Z",
};

describe("ProfileEditForm — translation preferences (P13-04)", () => {
	beforeEach(() => {
		updateMock.mockReset();
		pushMock.mockReset();
		refreshMock.mockReset();
		toastSuccessSpy.mockReset();
		updateMock.mockResolvedValue(BASE_USER);
	});

	it("renders language select with default 'ja' from initialUser", () => {
		render(<ProfileEditForm initialUser={BASE_USER} />);
		const select = screen.getByLabelText("UI 表示言語") as HTMLSelectElement;
		expect(select).toBeInTheDocument();
		expect(select.value).toBe("ja");
	});

	it("submits preferred_language=en when user changes select and saves", async () => {
		render(<ProfileEditForm initialUser={BASE_USER} />);
		const select = screen.getByLabelText("UI 表示言語");
		await userEvent.selectOptions(select, "en");
		await userEvent.click(screen.getByRole("button", { name: "保存" }));
		expect(updateMock).toHaveBeenCalledTimes(1);
		const payload = updateMock.mock.calls[0][0];
		expect(payload.preferred_language).toBe("en");
	});

	it("submits auto_translate=true when user enables the checkbox", async () => {
		render(<ProfileEditForm initialUser={BASE_USER} />);
		const toggle = screen.getByLabelText(
			"自動翻訳を有効にする",
		) as HTMLInputElement;
		expect(toggle.checked).toBe(false);
		await userEvent.click(toggle);
		expect(toggle.checked).toBe(true);
		await userEvent.click(screen.getByRole("button", { name: "保存" }));
		expect(updateMock).toHaveBeenCalledTimes(1);
		const payload = updateMock.mock.calls[0][0];
		expect(payload.auto_translate).toBe(true);
	});

	it("announces '自動翻訳を有効にしました' when auto_translate transitions false → true (P13-06)", async () => {
		render(<ProfileEditForm initialUser={BASE_USER} />);
		await userEvent.click(screen.getByLabelText("自動翻訳を有効にする"));
		await userEvent.click(screen.getByRole("button", { name: "保存" }));
		// react-toastify の toast.success は role=status の aria-live 領域を持つ。
		// 専用メッセージで「翻訳が ON になった」 を AT に明示する。
		expect(toastSuccessSpy).toHaveBeenCalledWith("自動翻訳を有効にしました");
	});

	it("uses generic '保存しました' message when auto_translate did not transition (P13-06)", async () => {
		// 既に ON のユーザーが言語のみ変えた → 専用メッセージは出さない
		const userWithAutoTranslateOn = {
			...BASE_USER,
			auto_translate: true,
		};
		render(<ProfileEditForm initialUser={userWithAutoTranslateOn} />);
		await userEvent.selectOptions(screen.getByLabelText("UI 表示言語"), "en");
		await userEvent.click(screen.getByRole("button", { name: "保存" }));
		expect(toastSuccessSpy).toHaveBeenCalledWith("プロフィールを保存しました");
	});
});
