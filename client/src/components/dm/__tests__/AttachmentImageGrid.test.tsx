/**
 * AttachmentImageGrid テスト (Issue #462).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AttachmentImageGrid from "@/components/dm/AttachmentImageGrid";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

const mkImg = (id: number, w = 640, h = 480): MessageAttachment => ({
	id,
	s3_key: `dm/1/${id}.png`,
	url: `https://stg.example/dm/1/${id}.png`,
	filename: `image${id}.png`,
	mime_type: "image/png",
	size: 1024,
	width: w,
	height: h,
});

describe("AttachmentImageGrid", () => {
	it("0 枚で何も render しない", () => {
		const { container } = render(
			<AttachmentImageGrid images={[]} onOpenLightbox={() => {}} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("1 枚で単独表示、width/height 属性付き", () => {
		render(
			<AttachmentImageGrid images={[mkImg(1)]} onOpenLightbox={() => {}} />,
		);
		const img = screen.getByAltText("image1.png");
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute("width", "640");
		expect(img).toHaveAttribute("height", "480");
	});

	it("2 枚で 2x1 grid", () => {
		render(
			<AttachmentImageGrid
				images={[mkImg(1), mkImg(2)]}
				onOpenLightbox={() => {}}
			/>,
		);
		expect(screen.getByTestId("grid-2")).toBeInTheDocument();
	});

	it("3 枚で 3-grid", () => {
		render(
			<AttachmentImageGrid
				images={[mkImg(1), mkImg(2), mkImg(3)]}
				onOpenLightbox={() => {}}
			/>,
		);
		expect(screen.getByTestId("grid-3")).toBeInTheDocument();
	});

	it("4 枚で 2x2", () => {
		render(
			<AttachmentImageGrid
				images={[mkImg(1), mkImg(2), mkImg(3), mkImg(4)]}
				onOpenLightbox={() => {}}
			/>,
		);
		expect(screen.getByTestId("grid-4")).toBeInTheDocument();
		expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
	});

	it("6 枚で 4 マスのみ render + 「+2」overlay", () => {
		render(
			<AttachmentImageGrid
				images={[1, 2, 3, 4, 5, 6].map((i) => mkImg(i))}
				onOpenLightbox={() => {}}
			/>,
		);
		expect(screen.getByTestId("grid-overflow")).toBeInTheDocument();
		expect(screen.getByText("+2")).toBeInTheDocument();
		// 4 枚目までしか img alt が出ない
		expect(screen.getAllByRole("img").length).toBe(4);
	});

	it("クリックで onOpenLightbox(index) 呼ばれる", async () => {
		const user = userEvent.setup();
		const onOpen = vi.fn();
		render(
			<AttachmentImageGrid
				images={[mkImg(1), mkImg(2)]}
				onOpenLightbox={onOpen}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: /image2.png を全画面/ }),
		);
		expect(onOpen).toHaveBeenCalledWith(1);
	});

	it("width/height 不在時のフォールバック (max-height)", () => {
		const att: MessageAttachment = { ...mkImg(1), width: null, height: null };
		render(<AttachmentImageGrid images={[att]} onOpenLightbox={() => {}} />);
		const img = screen.getByAltText("image1.png");
		expect(img).toHaveStyle({ maxHeight: "360px", objectFit: "contain" });
	});
});
