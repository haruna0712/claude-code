"use client";

/**
 * 画像 inline grid 表示 (Issue #462).
 *
 * 枚数別配置 (Teams / Slack 流):
 *  1 枚 = 単独 (max-w 480px)
 *  2 枚 = 横並び 1x2
 *  3 枚 = 左 1 大 / 右 2 縦
 *  4 枚 = 2x2
 *  5+ 枚 = 2x2 + 4 マス目右下に「+(N-3)」overlay
 *
 * 各 img:
 *  - alt = filename
 *  - width / height attribute (CLS=0)、null 時は max-height fallback
 *  - loading="lazy", decoding="async"
 *  - クリックで onOpenLightbox(index) を呼ぶ
 */

import Image from "next/image";

import type { MessageAttachment } from "@/lib/redux/features/dm/types";

interface AttachmentImageGridProps {
	images: MessageAttachment[];
	onOpenLightbox: (index: number) => void;
}

interface ImgProps {
	att: MessageAttachment;
	index: number;
	className?: string;
	overlay?: string | null;
	onOpenLightbox: (index: number) => void;
}

function GridImage({
	att,
	index,
	className,
	overlay,
	onOpenLightbox,
}: ImgProps) {
	const hasDimensions =
		typeof att.width === "number" && typeof att.height === "number";
	return (
		<button
			type="button"
			onClick={() => onOpenLightbox(index)}
			aria-label={
				overlay
					? `${att.filename}、他 ${overlay.replace("+", "")} 枚を表示`
					: `${att.filename} を全画面表示`
			}
			className={`relative block cursor-zoom-in overflow-hidden rounded ${className ?? ""}`}
		>
			{hasDimensions ? (
				<Image
					src={att.url}
					alt={att.filename}
					width={att.width as number}
					height={att.height as number}
					unoptimized
					loading="lazy"
					decoding="async"
					className="block h-full w-full object-cover"
				/>
			) : (
				// width/height 不在のフォールバック: 360px 高さで object-fit:contain
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={att.url}
					alt={att.filename}
					loading="lazy"
					decoding="async"
					style={{ maxHeight: 360, objectFit: "contain" }}
					className="block h-full w-full"
				/>
			)}
			{overlay ? (
				<span
					aria-hidden="true"
					className="absolute inset-0 flex items-center justify-center bg-black/60 text-2xl font-semibold text-white"
				>
					{overlay}
				</span>
			) : null}
		</button>
	);
}

export default function AttachmentImageGrid({
	images,
	onOpenLightbox,
}: AttachmentImageGridProps) {
	if (images.length === 0) return null;

	if (images.length === 1) {
		const a = images[0];
		const hasDim = typeof a.width === "number" && typeof a.height === "number";
		const aspect = hasDim ? `${a.width} / ${a.height}` : undefined;
		return (
			<div
				className="mt-2 max-w-[480px]"
				style={aspect ? { aspectRatio: aspect } : undefined}
			>
				<GridImage att={a} index={0} onOpenLightbox={onOpenLightbox} />
			</div>
		);
	}

	if (images.length === 2) {
		return (
			<div
				className="mt-2 grid max-w-[480px] grid-cols-2 gap-1"
				data-testid="grid-2"
			>
				{images.map((a, i) => (
					<div key={a.id} className="aspect-square">
						<GridImage att={a} index={i} onOpenLightbox={onOpenLightbox} />
					</div>
				))}
			</div>
		);
	}

	if (images.length === 3) {
		return (
			<div
				className="mt-2 grid max-w-[480px] grid-cols-2 grid-rows-2 gap-1"
				data-testid="grid-3"
			>
				<div className="row-span-2 aspect-[1/2]">
					<GridImage
						att={images[0]}
						index={0}
						onOpenLightbox={onOpenLightbox}
					/>
				</div>
				<div className="aspect-square">
					<GridImage
						att={images[1]}
						index={1}
						onOpenLightbox={onOpenLightbox}
					/>
				</div>
				<div className="aspect-square">
					<GridImage
						att={images[2]}
						index={2}
						onOpenLightbox={onOpenLightbox}
					/>
				</div>
			</div>
		);
	}

	// 4+ 枚: 2x2 grid。5+ なら 4 マス目に「+N」overlay
	const visible = images.slice(0, 4);
	const overflow = images.length - 4;
	return (
		<div
			className="mt-2 grid max-w-[480px] grid-cols-2 gap-1"
			data-testid={overflow > 0 ? "grid-overflow" : "grid-4"}
		>
			{visible.map((a, i) => (
				<div key={a.id} className="aspect-square">
					<GridImage
						att={a}
						index={i}
						overlay={i === 3 && overflow > 0 ? `+${overflow}` : undefined}
						onOpenLightbox={onOpenLightbox}
					/>
				</div>
			))}
		</div>
	);
}
