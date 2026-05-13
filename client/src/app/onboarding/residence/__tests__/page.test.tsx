/**
 * Tests for /onboarding/residence (P12-03).
 *
 * Step 2 prompt: 「居住地を設定するか?」 + 「あとで」 / 「今すぐ」 の link。
 * Pure presentational client component なので render snapshot 風の検証で十分。
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OnboardingResidencePage from "@/app/onboarding/residence/page";

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
	usePathname: () => "/onboarding/residence",
}));

describe("OnboardingResidencePage", () => {
	it("shows the step 2 prompt heading and privacy explanation", () => {
		render(<OnboardingResidencePage />);
		expect(
			screen.getByRole("heading", { name: /住んでる場所を設定しますか/ }),
		).toBeInTheDocument();
		// プライバシー説明: 半径 500m / ピンポイント不可
		expect(screen.getByText(/500m/)).toBeInTheDocument();
		expect(screen.getByText(/ピンポイント/)).toBeInTheDocument();
	});

	it("renders both 'set now' and 'skip' CTAs as proper links", () => {
		render(<OnboardingResidencePage />);
		const setNow = screen.getByRole("link", { name: /今すぐ設定する/ });
		expect(setNow).toHaveAttribute("href", "/settings/residence");
		const skip = screen.getByRole("link", { name: /あとで設定する/ });
		expect(skip).toHaveAttribute("href", "/");
	});

	it("step indicator marks step 2 (居住地) as current", () => {
		render(<OnboardingResidencePage />);
		// 「居住地 (任意)」 (step indicator) を指す。 本文の「居住地」 とは区別。
		const currentStep = screen
			.getByRole("list", { name: "オンボーディングの進行状況" })
			.querySelector("li[aria-current='step']");
		expect(currentStep).not.toBeNull();
		expect(currentStep?.textContent).toMatch(/居住地/);
	});
});
