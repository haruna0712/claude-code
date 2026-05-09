/**
 * AttachmentLightbox テスト (Issue #463).
 *
 * Radix Dialog の focus trap / ESC は radix-ui 側で担保されているため、
 * 本テストでは「open 時に role=dialog が出る」「ナビ button で index 切替」
 * 「外側 click で onOpenChange(false)」を中心に検証する。
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AttachmentLightbox from "@/components/dm/AttachmentLightbox";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

const mkImg = (id: number): MessageAttachment => ({
	id,
	s3_key: `dm/1/${id}.png`,
	url: `https://stg.example/dm/1/${id}.png`,
	filename: `pic${id}.png`,
	mime_type: "image/png",
	size: 2048,
	width: 640,
	height: 480,
});

describe("AttachmentLightbox", () => {
	it("openIndex=null で何も render しない", () => {
		render(
			<AttachmentLightbox
				images={[mkImg(1)]}
				openIndex={null}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("openIndex=0 で dialog 出てfilename ヘッダー表示", () => {
		render(
			<AttachmentLightbox
				images={[mkImg(1), mkImg(2)]}
				openIndex={0}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.getByText("pic1.png")).toBeInTheDocument();
		// 複数枚なら counter
		expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
	});

	it("複数枚で次/前ボタンで index 切替", async () => {
		const user = userEvent.setup();
		render(
			<AttachmentLightbox
				images={[mkImg(1), mkImg(2), mkImg(3)]}
				openIndex={0}
				onOpenChange={() => {}}
			/>,
		);
		expect(screen.getByText("pic1.png")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "次の画像" }));
		expect(screen.getByText("pic2.png")).toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "前の画像" }));
		expect(screen.getByText("pic1.png")).toBeInTheDocument();
		// wrap (前で 0→末尾)
		await user.click(screen.getByRole("button", { name: "前の画像" }));
		expect(screen.getByText("pic3.png")).toBeInTheDocument();
	});

	it("1 枚なら次/前ボタンが出ない", () => {
		render(
			<AttachmentLightbox
				images={[mkImg(1)]}
				openIndex={0}
				onOpenChange={() => {}}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "次の画像" }),
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole("button", { name: "前の画像" }),
		).not.toBeInTheDocument();
	});

	it("ダウンロード anchor が href + download 属性付き", () => {
		render(
			<AttachmentLightbox
				images={[mkImg(1)]}
				openIndex={0}
				onOpenChange={() => {}}
			/>,
		);
		const link = screen.getByRole("link", { name: /pic1\.png をダウンロード/ });
		expect(link).toHaveAttribute("href", "https://stg.example/dm/1/1.png");
		expect(link).toHaveAttribute("download", "pic1.png");
	});

	it("× ボタンで onOpenChange(false)", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		render(
			<AttachmentLightbox
				images={[mkImg(1)]}
				openIndex={0}
				onOpenChange={onOpenChange}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "閉じる" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
