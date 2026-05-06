/**
 * Tests for NotificationsList (#412).
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import NotificationsList from "@/components/notifications/NotificationsList";
import type { NotificationItem } from "@/lib/api/notifications";

const { fetchNotificationsMock, markAllMock, markOneMock } = vi.hoisted(() => ({
	fetchNotificationsMock: vi.fn(),
	markAllMock: vi.fn(),
	markOneMock: vi.fn(),
}));

vi.mock("@/lib/api/notifications", () => ({
	fetchNotifications: fetchNotificationsMock,
	markAllNotificationsRead: markAllMock,
	markNotificationRead: markOneMock,
}));

const sampleLike: NotificationItem = {
	id: "11111111-1111-1111-1111-111111111111",
	kind: "like",
	actor: {
		id: "22222222-2222-2222-2222-222222222222",
		handle: "alice",
		display_name: "Alice",
		avatar_url: "",
	},
	target_type: "tweet",
	target_id: "100",
	target_preview: { type: "tweet", body_excerpt: "hello", is_deleted: false },
	read: false,
	read_at: null,
	created_at: "2026-05-06T00:00:00Z",
};

const sampleFollow: NotificationItem = {
	id: "33333333-3333-3333-3333-333333333333",
	kind: "follow",
	actor: {
		id: "44444444-4444-4444-4444-444444444444",
		handle: "bob",
		display_name: "Bob",
		avatar_url: "",
	},
	target_type: "user",
	target_id: "44444444-4444-4444-4444-444444444444",
	target_preview: null,
	read: true,
	read_at: "2026-05-05T00:00:00Z",
	created_at: "2026-05-05T00:00:00Z",
};

describe("NotificationsList", () => {
	beforeEach(() => {
		fetchNotificationsMock.mockReset();
		markAllMock.mockReset();
		markOneMock.mockReset();
	});

	it("renders heading and list items after fetch", async () => {
		fetchNotificationsMock.mockResolvedValueOnce({
			results: [sampleLike, sampleFollow],
			next: null,
			previous: null,
		});
		render(<NotificationsList />);
		await screen.findByText(/Alice さんがあなたのツイートにいいねしました/);
		expect(
			screen.getByText(/Bob さんがあなたをフォローしました/),
		).toBeInTheDocument();
	});

	it("renders empty state when no notifications", async () => {
		fetchNotificationsMock.mockResolvedValueOnce({
			results: [],
			next: null,
			previous: null,
		});
		render(<NotificationsList />);
		await screen.findByText(/通知はありません/);
	});

	it("calls markAllNotificationsRead on mount when there are unread notifications", async () => {
		fetchNotificationsMock.mockResolvedValueOnce({
			results: [sampleLike], // unread
			next: null,
			previous: null,
		});
		markAllMock.mockResolvedValueOnce(undefined);
		render(<NotificationsList />);
		await waitFor(() => {
			expect(markAllMock).toHaveBeenCalledTimes(1);
		});
	});

	it("does NOT call markAllNotificationsRead when all are already read", async () => {
		fetchNotificationsMock.mockResolvedValueOnce({
			results: [sampleFollow], // read=true
			next: null,
			previous: null,
		});
		render(<NotificationsList />);
		await screen.findByText(/Bob/);
		expect(markAllMock).not.toHaveBeenCalled();
	});

	it("marks individual notification as read on click", async () => {
		fetchNotificationsMock.mockResolvedValueOnce({
			results: [sampleLike],
			next: null,
			previous: null,
		});
		markOneMock.mockResolvedValueOnce(undefined);
		render(<NotificationsList />);
		const link = await screen.findByRole("link", { name: /Alice/ });
		expect(link).toHaveAttribute("href", "/tweet/100");
		await userEvent.click(link);
		await waitFor(() => {
			expect(markOneMock).toHaveBeenCalledWith(sampleLike.id);
		});
	});

	it("renders error fallback on fetch failure", async () => {
		fetchNotificationsMock.mockRejectedValueOnce(new Error("500"));
		render(<NotificationsList />);
		await screen.findByRole("alert");
		expect(screen.getByText(/取得に失敗/)).toBeInTheDocument();
	});

	it("toggles unread-only filter via tabs", async () => {
		fetchNotificationsMock
			.mockResolvedValueOnce({
				results: [sampleLike, sampleFollow],
				next: null,
				previous: null,
			})
			.mockResolvedValueOnce({
				results: [sampleLike],
				next: null,
				previous: null,
			});
		render(<NotificationsList />);
		await screen.findByText(/Bob/);

		await userEvent.click(screen.getByRole("button", { name: /未読のみ/ }));

		await waitFor(() => {
			expect(fetchNotificationsMock).toHaveBeenLastCalledWith({
				unread_only: true,
			});
		});
	});
});
