"use client";

/**
 * 画像 lightbox (Issue #463).
 *
 * - Radix Dialog ベース (focus trap / ESC / overlay click は Radix が担当)
 * - 複数画像で ←→ ナビ + ヘッダー「N / M」
 * - ダウンロードボタン
 * - prefers-reduced-motion: reduce 対応 (CSS で transition 無効化)
 * - open 時の previous focus は Radix の `onOpenAutoFocus` 経由で復帰される
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import { formatFileSize } from "@/lib/dm/attachmentDisplay";
import type { MessageAttachment } from "@/lib/redux/features/dm/types";

interface AttachmentLightboxProps {
	images: MessageAttachment[];
	openIndex: number | null;
	onOpenChange: (open: boolean) => void;
}

export default function AttachmentLightbox({
	images,
	openIndex,
	onOpenChange,
}: AttachmentLightboxProps) {
	const [index, setIndex] = useState<number>(openIndex ?? 0);
	const isOpen = openIndex !== null;

	useEffect(() => {
		if (openIndex !== null) setIndex(openIndex);
	}, [openIndex]);

	useEffect(() => {
		if (!isOpen) return;
		const handler = (e: KeyboardEvent) => {
			if (images.length <= 1) return;
			if (e.key === "ArrowRight") {
				e.preventDefault();
				setIndex((i) => (i + 1) % images.length);
			} else if (e.key === "ArrowLeft") {
				e.preventDefault();
				setIndex((i) => (i - 1 + images.length) % images.length);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isOpen, images.length]);

	if (images.length === 0) return null;
	const att = images[Math.min(index, images.length - 1)];
	if (!att) return null;

	const sizeLabel = formatFileSize(att.size);
	const counter = images.length > 1 ? `${index + 1} / ${images.length}` : null;

	return (
		<DialogPrimitive.Root open={isOpen} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
				<DialogPrimitive.Content
					aria-labelledby="lightbox-title"
					aria-describedby="lightbox-desc"
					className="fixed inset-0 z-50 flex flex-col motion-reduce:animate-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
					onPointerDownOutside={() => onOpenChange(false)}
				>
					{/* header */}
					<header className="flex items-center justify-between gap-3 px-4 py-3 text-white">
						<div className="min-w-0">
							<DialogPrimitive.Title
								id="lightbox-title"
								className="truncate text-sm font-semibold"
							>
								{att.filename}
							</DialogPrimitive.Title>
							<DialogPrimitive.Description
								id="lightbox-desc"
								className="text-xs text-gray-300"
							>
								{sizeLabel}
								{counter ? ` ・ ${counter}` : ""}
							</DialogPrimitive.Description>
						</div>
						<div className="flex items-center gap-2">
							<a
								href={att.url}
								download={att.filename}
								target="_blank"
								rel="noopener noreferrer"
								aria-label={`${att.filename} をダウンロード`}
								className="rounded border border-white/30 px-3 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
							>
								⬇ ダウンロード
							</a>
							<DialogPrimitive.Close
								aria-label="閉じる"
								className="rounded border border-white/30 px-3 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
							>
								✕
							</DialogPrimitive.Close>
						</div>
					</header>
					{/* image */}
					<div className="relative flex flex-1 items-center justify-center p-4">
						{images.length > 1 ? (
							<button
								type="button"
								onClick={() =>
									setIndex((i) => (i - 1 + images.length) % images.length)
								}
								aria-label="前の画像"
								className="absolute left-2 z-10 rounded-full bg-black/50 px-3 py-2 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
							>
								←
							</button>
						) : null}
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={att.url}
							alt={att.filename}
							className="max-h-full max-w-full object-contain"
						/>
						{images.length > 1 ? (
							<button
								type="button"
								onClick={() => setIndex((i) => (i + 1) % images.length)}
								aria-label="次の画像"
								className="absolute right-2 z-10 rounded-full bg-black/50 px-3 py-2 text-white hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
							>
								→
							</button>
						) : null}
					</div>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
