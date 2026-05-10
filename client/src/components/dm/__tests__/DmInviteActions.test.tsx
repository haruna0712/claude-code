/**
 * Tests for DmInviteActions (#489).
 *
 * 通知 row 内に inline で出す「承諾 / 拒否」 button。
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DmInviteActions from "@/components/dm/DmInviteActions";

const mockAccept = vi.fn();
const mockDecline = vi.fn();

vi.mock("@/lib/api/dm-invitations", () => ({
	acceptInvitation: (id: number) => mockAccept(id),
	declineInvitation: (id: number) => mockDecline(id),
}));

beforeEach(() => {
	mockAccept.mockReset();
	mockDecline.mockReset();
});

describe("DmInviteActions", () => {
	it("承諾 button click → acceptInvitation 呼び出し → status=参加しました", async () => {
		mockAccept.mockResolvedValueOnce(undefined);
		const onResolved = vi.fn();
		render(<DmInviteActions invitationId={42} onResolved={onResolved} />);
		await userEvent.click(screen.getByRole("button", { name: /承諾/ }));
		await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(42));
		expect(await screen.findByRole("status")).toHaveTextContent(/参加しました/);
		await waitFor(() => expect(onResolved).toHaveBeenCalledWith("accepted"), {
			timeout: 3000,
		});
	});

	it("拒否 button click → declineInvitation → status=拒否しました", async () => {
		mockDecline.mockResolvedValueOnce(undefined);
		const onResolved = vi.fn();
		render(<DmInviteActions invitationId={43} onResolved={onResolved} />);
		await userEvent.click(screen.getByRole("button", { name: /拒否/ }));
		await waitFor(() => expect(mockDecline).toHaveBeenCalledWith(43));
		expect(await screen.findByRole("status")).toHaveTextContent(/拒否しました/);
		await waitFor(() => expect(onResolved).toHaveBeenCalledWith("declined"), {
			timeout: 3000,
		});
	});

	it("API 失敗 → role=alert で error メッセージ", async () => {
		mockAccept.mockRejectedValueOnce(new Error("backend down"));
		render(<DmInviteActions invitationId={44} />);
		await userEvent.click(screen.getByRole("button", { name: /承諾/ }));
		expect(await screen.findByRole("alert")).toHaveTextContent(/失敗/);
	});

	it("送信中は両 button が disabled (aria-busy)", async () => {
		// resolve しない promise で in-flight 状態を保つ
		let resolver: () => void = () => {};
		mockAccept.mockReturnValueOnce(
			new Promise<void>((resolve) => {
				resolver = resolve;
			}),
		);
		render(<DmInviteActions invitationId={45} />);
		const accept = screen.getByRole("button", { name: /承諾/ });
		const decline = screen.getByRole("button", { name: /拒否/ });
		await userEvent.click(accept);
		// in-flight 中は両方 disabled
		await waitFor(() => expect(accept).toBeDisabled());
		expect(decline).toBeDisabled();
		// cleanup
		resolver();
	});
});
