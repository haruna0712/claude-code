/**
 * Tests for SettingsMenu (#406).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsMenu from "@/components/shared/navbar/SettingsMenu";

const { setThemeSpy, themeRef } = vi.hoisted(() => ({
	setThemeSpy: vi.fn(),
	themeRef: { value: "system" as "light" | "dark" | "system" },
}));

vi.mock("next-themes", () => ({
	useTheme: () => ({ theme: themeRef.value, setTheme: setThemeSpy }),
}));

describe("SettingsMenu", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		themeRef.value = "system";
	});

	it("renders a 設定 trigger button", () => {
		render(<SettingsMenu />);
		expect(screen.getByRole("button", { name: "設定" })).toBeInTheDocument();
	});

	it("opens dropdown on click and shows the three theme options", async () => {
		render(<SettingsMenu />);
		await userEvent.click(screen.getByRole("button", { name: "設定" }));
		expect(
			screen.getByRole("menuitem", { name: /ライト/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("menuitem", { name: /ダーク/ }),
		).toBeInTheDocument();
		expect(
			screen.getByRole("menuitem", { name: /システム/ }),
		).toBeInTheDocument();
	});

	it("calls setTheme('dark') when the ダーク item is clicked", async () => {
		render(<SettingsMenu />);
		await userEvent.click(screen.getByRole("button", { name: "設定" }));
		await userEvent.click(screen.getByRole("menuitem", { name: /ダーク/ }));
		expect(setThemeSpy).toHaveBeenCalledWith("dark");
	});

	it("highlights the currently selected theme with '選択中' label", async () => {
		themeRef.value = "light";
		render(<SettingsMenu />);
		await userEvent.click(screen.getByRole("button", { name: "設定" }));
		const lightItem = screen.getByRole("menuitem", { name: /ライト/ });
		expect(lightItem).toHaveTextContent(/選択中/);
		const darkItem = screen.getByRole("menuitem", { name: /ダーク/ });
		expect(darkItem).not.toHaveTextContent(/選択中/);
	});

	it("renders a logout item when onLogout is provided and calls it on click", async () => {
		const onLogout = vi.fn();
		render(<SettingsMenu onLogout={onLogout} />);
		await userEvent.click(screen.getByRole("button", { name: "設定" }));
		await userEvent.click(screen.getByRole("menuitem", { name: /ログアウト/ }));
		expect(onLogout).toHaveBeenCalledTimes(1);
	});

	it("does not render a logout item when onLogout is not provided", async () => {
		render(<SettingsMenu />);
		await userEvent.click(screen.getByRole("button", { name: "設定" }));
		expect(
			screen.queryByRole("menuitem", { name: /ログアウト/ }),
		).not.toBeInTheDocument();
	});
});
