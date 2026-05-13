"use client";

/**
 * 他人の (or 自分の) プロフィール page に embed する read-only 居住地 map (P12-02)。
 *
 * dynamic import 経由で SSR を完全に切る。 Leaflet が `window` 前提なので
 * Next.js App Router の SSR とは相性が悪い (`navigator is not defined` を吐く)。
 */

import dynamic from "next/dynamic";

import type { UserResidence } from "@/lib/api/residence";

const ResidenceCircleMap = dynamic(() => import("./ResidenceCircleMap"), {
	ssr: false,
	loading: () => (
		<div
			className="rounded-lg border bg-[color:var(--a-bg-muted)]"
			style={{ borderColor: "var(--a-border)", height: 240 }}
			aria-label="地図を読み込み中"
		/>
	),
});

interface ResidenceMapPreviewProps {
	residence: UserResidence;
	height?: number;
}

export default function ResidenceMapPreview({
	residence,
	height = 240,
}: ResidenceMapPreviewProps) {
	const lat = Number(residence.latitude);
	const lng = Number(residence.longitude);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		// 不正な数値が来たら map を出さない (壊れた表示を避ける)
		return null;
	}
	const km = (residence.radius_m / 1000).toFixed(1);
	return (
		<div className="space-y-2">
			<ResidenceCircleMap
				lat={lat}
				lng={lng}
				radiusM={residence.radius_m}
				height={height}
				interactive={false}
			/>
			<p className="text-[color:var(--a-text-muted)]" style={{ fontSize: 12 }}>
				半径 約 {km} km の範囲
			</p>
		</div>
	);
}
