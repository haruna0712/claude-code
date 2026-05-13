/**
 * Tests for OnboardingForm (P1-14 / P12-03).
 *
 * 主要シナリオは P12-03 で追加した step 2 (/onboarding/residence) への遷移。
 * 既存 step 1 (display_name / bio 入力 → completeOnboarding) のロジックも回帰
 * チェック対象。
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingForm from "@/components/forms/onboarding/OnboardingForm";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
	usePathname: () => "/onboarding",
}));

// completeOnboarding を successful な promise に mock。
const completeOnboardingMock = vi.fn();
vi.mock("@/lib/api/users", () => ({
	completeOnboarding: (...args: Parameters<typeof completeOnboardingMock>) =>
		completeOnboardingMock(...args),
}));

describe("OnboardingForm", () => {
	beforeEach(() => {
		mockPush.mockClear();
		mockRefresh.mockClear();
		completeOnboardingMock.mockClear();
	});

	it("renders display_name input and submit button", () => {
		render(<OnboardingForm />);
		expect(screen.getByLabelText(/表示名/)).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: /はじめる/ }),
		).toBeInTheDocument();
	});

	it("redirects to /onboarding/residence on successful submit (P12-03)", async () => {
		completeOnboardingMock.mockResolvedValue({
			id: "u1",
			username: "alice",
			display_name: "Alice",
			needs_onboarding: false,
		});
		render(<OnboardingForm />);

		await userEvent.type(screen.getByLabelText(/表示名/), "Alice");
		fireEvent.click(screen.getByRole("button", { name: /はじめる/ }));

		await waitFor(() => {
			expect(mockPush).toHaveBeenCalledWith("/onboarding/residence");
		});
		// `/` ではない (P12-03 前は `/` だった)
		expect(mockPush).not.toHaveBeenCalledWith("/");
		expect(completeOnboardingMock).toHaveBeenCalledWith({
			display_name: "Alice",
			bio: "",
		});
	});

	it("does not navigate when submit fails", async () => {
		completeOnboardingMock.mockRejectedValue(new Error("boom"));
		render(<OnboardingForm />);

		await userEvent.type(screen.getByLabelText(/表示名/), "Bob");
		fireEvent.click(screen.getByRole("button", { name: /はじめる/ }));

		await waitFor(() => {
			expect(completeOnboardingMock).toHaveBeenCalled();
		});
		expect(mockPush).not.toHaveBeenCalled();
	});
});
