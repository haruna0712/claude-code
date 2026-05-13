/**
 * Tests for MentorRequestForm (P11-06).
 *
 * 検証:
 *   T-MENTOR-FORM-1 empty title で submit すると role=alert で警告、 createMentorRequest は呼ばれない
 *   T-MENTOR-FORM-2 empty body で submit すると role=alert で警告
 *   T-MENTOR-FORM-3 正常入力で createMentorRequest が呼ばれ toast + router.push
 *   T-MENTOR-FORM-4 タグ csv は trim + 空除去で配列化される
 *   T-MENTOR-FORM-5 API エラーで error が表示される (router.push しない)
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import MentorRequestForm from "@/components/mentorship/MentorRequestForm";

const { routerPushMock } = vi.hoisted(() => ({ routerPushMock: vi.fn() }));

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

const { createMentorRequestMock } = vi.hoisted(() => ({
	createMentorRequestMock: vi.fn(),
}));

vi.mock("@/lib/api/mentor", () => ({
	createMentorRequest: createMentorRequestMock,
}));

describe("MentorRequestForm (P11-06)", () => {
	beforeEach(() => {
		routerPushMock.mockReset();
		toastSuccessMock.mockReset();
		toastErrorMock.mockReset();
		createMentorRequestMock.mockReset();
	});

	const fillForm = (title: string, body: string, tags = "") => {
		fireEvent.change(screen.getByLabelText(/タイトル/, { selector: "input" }), {
			target: { value: title },
		});
		fireEvent.change(screen.getByLabelText(/^本文/, { selector: "textarea" }), {
			target: { value: body },
		});
		if (tags) {
			fireEvent.change(
				screen.getByLabelText(/関連スキル/, { selector: "input" }),
				{
					target: { value: tags },
				},
			);
		}
	};

	it("T-MENTOR-FORM-1 empty title はクライアント側で reject", async () => {
		render(<MentorRequestForm />);
		fillForm("", "body has content");
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター募集フォーム"));
		});
		expect(screen.getByRole("alert").textContent).toMatch(/タイトル/);
		expect(createMentorRequestMock).not.toHaveBeenCalled();
	});

	it("T-MENTOR-FORM-2 empty body も同様に reject", async () => {
		render(<MentorRequestForm />);
		fillForm("title", "");
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター募集フォーム"));
		});
		expect(screen.getByRole("alert").textContent).toMatch(/本文/);
		expect(createMentorRequestMock).not.toHaveBeenCalled();
	});

	it("T-MENTOR-FORM-3 正常 submit で API call + toast + redirect", async () => {
		createMentorRequestMock.mockResolvedValueOnce({ id: 42, title: "Hello" });
		render(<MentorRequestForm />);
		fillForm("Hello", "body content");
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター募集フォーム"));
		});
		expect(createMentorRequestMock).toHaveBeenCalledWith({
			title: "Hello",
			body: "body content",
			target_skill_tag_names: [],
		});
		expect(toastSuccessMock).toHaveBeenCalledWith("募集を投稿しました");
		expect(routerPushMock).toHaveBeenCalledWith("/mentor/wanted/42");
	});

	it("T-MENTOR-FORM-4 タグ csv は trim + 空除去で配列化", async () => {
		createMentorRequestMock.mockResolvedValueOnce({ id: 1 });
		render(<MentorRequestForm />);
		fillForm("t", "b", "  django ,  drf, ,  python ");
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター募集フォーム"));
		});
		expect(createMentorRequestMock).toHaveBeenCalledWith(
			expect.objectContaining({
				target_skill_tag_names: ["django", "drf", "python"],
			}),
		);
	});

	it("T-MENTOR-FORM-5 API エラーで error 表示 + redirect しない", async () => {
		createMentorRequestMock.mockRejectedValueOnce({
			response: { data: { detail: "未登録 / 未承認のタグ: foo" } },
		});
		render(<MentorRequestForm />);
		fillForm("t", "b", "foo");
		await act(async () => {
			fireEvent.submit(screen.getByLabelText("メンター募集フォーム"));
		});
		expect(screen.getByRole("alert").textContent).toMatch(/未登録/);
		expect(routerPushMock).not.toHaveBeenCalled();
	});
});
