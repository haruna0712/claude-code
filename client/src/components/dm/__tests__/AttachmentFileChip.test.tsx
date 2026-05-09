/**
 * AttachmentFileChip テスト (Issue #462).
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AttachmentFileChip from "@/components/dm/AttachmentFileChip";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

const att: MessageAttachment = {
	id: 1,
	s3_key: "dm/1/x.pdf",
	url: "https://stg.example/dm/1/x.pdf",
	filename: "report.pdf",
	mime_type: "application/pdf",
	size: 1572864, // 1.5 MB
	width: null,
	height: null,
};

describe("AttachmentFileChip", () => {
	it("ダウンロード可能な anchor として render", () => {
		render(<AttachmentFileChip attachment={att} />);
		const link = screen.getByRole("link", {
			name: /ダウンロード: report\.pdf \(1\.5 MB\)/,
		});
		expect(link).toHaveAttribute("href", "https://stg.example/dm/1/x.pdf");
		expect(link).toHaveAttribute("download", "report.pdf");
	});
	it("MIME 別アイコン文字 + filename + size", () => {
		render(<AttachmentFileChip attachment={att} />);
		expect(screen.getByText("📄")).toBeInTheDocument();
		expect(screen.getByText("report.pdf")).toBeInTheDocument();
		expect(screen.getByText("1.5 MB")).toBeInTheDocument();
	});
});
