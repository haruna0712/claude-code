import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AttachmentUploader from "@/components/dm/AttachmentUploader";

import * as attachments from "@/lib/dm/attachments";

vi.mock("@/lib/dm/attachments", async () => {
	const actual = await vi.importActual<typeof import("@/lib/dm/attachments")>(
		"@/lib/dm/attachments",
	);
	return {
		...actual,
		uploadAttachment: vi.fn(),
	};
});

const uploadAttachmentMock = vi.mocked(attachments.uploadAttachment);

beforeEach(() => {
	uploadAttachmentMock.mockReset();
});

function makeFile(name: string, type: string, size: number): File {
	const blob = new Blob([new Uint8Array(Math.min(size, 16))], { type });
	const file = new File([blob], name, { type });
	Object.defineProperty(file, "size", { value: size });
	return file;
}

describe("AttachmentUploader", () => {
	it("ボタンが label で識別できる", () => {
		render(<AttachmentUploader roomId={1} onUploaded={() => {}} />);
		expect(
			screen.getByRole("button", { name: "添付ファイルを選択" }),
		).toBeInTheDocument();
	});

	it("非対応 MIME はサーバを叩かず alert を出す", async () => {
		const onUploaded = vi.fn();
		render(<AttachmentUploader roomId={1} onUploaded={onUploaded} />);
		const file = makeFile("video.mp4", "video/mp4", 1024);
		const input = screen.getByTestId("attachment-input") as HTMLInputElement;
		// accept attr 付きでも userEvent.upload は applyAccept: false で flag を落として注入する。
		await userEvent.upload(input, file, { applyAccept: false });
		expect(uploadAttachmentMock).not.toHaveBeenCalled();
		expect(await screen.findByRole("alert")).toHaveTextContent(/非対応/);
	});

	it("成功時に onUploaded が呼ばれる", async () => {
		uploadAttachmentMock.mockResolvedValue({
			id: 7,
			s3_key: "dm/1/2026/05/x.jpg",
			filename: "photo.jpg",
			mime_type: "image/jpeg",
			size: 1024,
			width: null,
			height: null,
		});
		const onUploaded = vi.fn();
		render(<AttachmentUploader roomId={1} onUploaded={onUploaded} />);
		const file = makeFile("photo.jpg", "image/jpeg", 1024);
		await userEvent.upload(screen.getByTestId("attachment-input"), file);
		expect(uploadAttachmentMock).toHaveBeenCalledWith(
			expect.objectContaining({ roomId: 1, file }),
		);
		expect(onUploaded).toHaveBeenCalledWith(
			expect.objectContaining({ id: 7, filename: "photo.jpg" }),
		);
	});

	it("失敗時は alert + onUploaded は呼ばれない", async () => {
		uploadAttachmentMock.mockRejectedValue(new Error("S3 down"));
		const onUploaded = vi.fn();
		render(<AttachmentUploader roomId={1} onUploaded={onUploaded} />);
		const file = makeFile("photo.jpg", "image/jpeg", 1024);
		await userEvent.upload(screen.getByTestId("attachment-input"), file);
		expect(await screen.findByRole("alert")).toHaveTextContent("S3 down");
		expect(onUploaded).not.toHaveBeenCalled();
	});
});
