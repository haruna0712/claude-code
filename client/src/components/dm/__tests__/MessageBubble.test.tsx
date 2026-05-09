import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MessageBubble from "@/components/dm/MessageBubble";
import type { DMMessage } from "@/lib/redux/features/dm/types";

function makeMessage(overrides: Partial<DMMessage> = {}): DMMessage {
	return {
		id: 1,
		room_id: 10,
		sender_id: 100,
		body: "hello",
		attachments: [],
		created_at: "2026-05-01T12:00:00Z",
		updated_at: "2026-05-01T12:00:00Z",
		deleted_at: null,
		...overrides,
	};
}

describe("MessageBubble", () => {
	it("自分のメッセージは data-mine='true'", () => {
		render(<MessageBubble message={makeMessage()} currentUserId={100} />);
		expect(screen.getByTestId("message-bubble")).toHaveAttribute(
			"data-mine",
			"true",
		);
	});

	it("他人のメッセージは data-mine='false'", () => {
		render(<MessageBubble message={makeMessage()} currentUserId={999} />);
		expect(screen.getByTestId("message-bubble")).toHaveAttribute(
			"data-mine",
			"false",
		);
	});

	it("status='sending' で data-status='sending'", () => {
		render(
			<MessageBubble
				message={makeMessage()}
				currentUserId={100}
				status="sending"
			/>,
		);
		expect(screen.getByTestId("message-bubble")).toHaveAttribute(
			"data-status",
			"sending",
		);
	});

	it("status='failed' で再送ボタン表示", () => {
		render(
			<MessageBubble
				message={makeMessage()}
				currentUserId={100}
				status="failed"
				onRetry={() => {}}
			/>,
		);
		expect(screen.getByRole("button", { name: /再試行/ })).toBeInTheDocument();
	});

	// Issue #462: 画像 attachment は <img alt={filename}> で表示される
	it("画像 attachment は img alt として filename を表示", () => {
		render(
			<MessageBubble
				message={makeMessage({
					attachments: [
						{
							id: 1,
							s3_key: "dm/10/2026/05/x.jpg",
							url: "https://stg.example/dm/10/2026/05/x.jpg",
							filename: "photo.jpg",
							mime_type: "image/jpeg",
							size: 1024,
							width: 640,
							height: 480,
						},
					],
				})}
				currentUserId={100}
			/>,
		);
		expect(screen.getByAltText("photo.jpg")).toBeInTheDocument();
	});

	it("非画像 attachment は file chip として filename テキスト表示 + ダウンロードリンク", () => {
		render(
			<MessageBubble
				message={makeMessage({
					attachments: [
						{
							id: 2,
							s3_key: "dm/10/2026/05/x.pdf",
							url: "https://stg.example/dm/10/2026/05/x.pdf",
							filename: "doc.pdf",
							mime_type: "application/pdf",
							size: 1024,
							width: null,
							height: null,
						},
					],
				})}
				currentUserId={100}
			/>,
		);
		expect(screen.getByText("doc.pdf")).toBeInTheDocument();
		const link = screen.getByRole("link", { name: /ダウンロード: doc\.pdf/ });
		expect(link).toHaveAttribute(
			"href",
			"https://stg.example/dm/10/2026/05/x.pdf",
		);
	});
});
