/**
 * Tests for NotificationSettingsForm (#415).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NotificationSettingsForm from "@/components/notifications/NotificationSettingsForm";

const { fetchMock, updateMock, toastErrorSpy } = vi.hoisted(() => ({
	fetchMock: vi.fn(),
	updateMock: vi.fn(),
	toastErrorSpy: vi.fn(),
}));

vi.mock("@/lib/api/notifications", () => ({
	fetchNotificationSettings: fetchMock,
	updateNotificationSetting: updateMock,
}));

vi.mock("react-toastify", () => ({
	toast: { error: toastErrorSpy, success: vi.fn() },
}));

const FULL_SETTINGS = [
	{ kind: "like", enabled: true },
	{ kind: "repost", enabled: true },
	{ kind: "quote", enabled: true },
	{ kind: "reply", enabled: true },
	{ kind: "mention", enabled: true },
	{ kind: "follow", enabled: true },
	{ kind: "dm_message", enabled: true },
	{ kind: "dm_invite", enabled: true },
	{ kind: "article_comment", enabled: true },
	{ kind: "article_like", enabled: true },
];

describe("NotificationSettingsForm", () => {
	beforeEach(() => {
		fetchMock.mockReset();
		updateMock.mockReset();
		toastErrorSpy.mockReset();
	});

	it("renders 10 toggles after fetch (6 active + 4 disabled future)", async () => {
		fetchMock.mockResolvedValueOnce(FULL_SETTINGS);
		render(<NotificationSettingsForm />);
		// 「いいね」は label として 2 箇所 (like / article_like) に出るので strict match
		await screen.findByRole("switch", { name: "いいね の通知" });
		const switches = screen.getAllByRole("switch");
		expect(switches.length).toBe(10);
	});

	it("disabled future-kind toggles are not interactive (Phase 3/5)", async () => {
		fetchMock.mockResolvedValueOnce(FULL_SETTINGS);
		render(<NotificationSettingsForm />);
		await screen.findByText(/DM/);
		const dmToggle = screen.getByRole("switch", { name: /DM の通知/ });
		expect(dmToggle).toBeDisabled();
	});

	it("toggles a setting and calls updateNotificationSetting", async () => {
		fetchMock.mockResolvedValueOnce(FULL_SETTINGS);
		updateMock.mockResolvedValueOnce({ kind: "like", enabled: false });
		render(<NotificationSettingsForm />);
		const likeToggle = await screen.findByRole("switch", {
			name: "いいね の通知",
		});
		expect(likeToggle).toHaveAttribute("aria-checked", "true");

		await userEvent.click(likeToggle);
		// 楽観的に false に切替
		expect(likeToggle).toHaveAttribute("aria-checked", "false");
		await waitFor(() => {
			expect(updateMock).toHaveBeenCalledWith("like", false);
		});
	});

	it("rolls back optimistic toggle and shows toast on failure", async () => {
		fetchMock.mockResolvedValueOnce(FULL_SETTINGS);
		updateMock.mockRejectedValueOnce(new Error("500"));
		render(<NotificationSettingsForm />);
		const likeToggle = await screen.findByRole("switch", {
			name: "いいね の通知",
		});
		await userEvent.click(likeToggle);
		// 楽観的に false → rollback で true に戻る
		await waitFor(() => {
			expect(likeToggle).toHaveAttribute("aria-checked", "true");
		});
		expect(toastErrorSpy).toHaveBeenCalled();
	});

	it("shows error fallback on initial fetch failure", async () => {
		fetchMock.mockRejectedValueOnce(new Error("network"));
		render(<NotificationSettingsForm />);
		await screen.findByRole("alert");
		expect(screen.getByText(/取得に失敗/)).toBeInTheDocument();
	});
});
