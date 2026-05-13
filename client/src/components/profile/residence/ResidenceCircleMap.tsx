"use client";

/**
 * 居住地を **円** で表示するだけの read-only map (Phase 12 P12-02)。
 *
 * クライアントオンリー: Leaflet は `window` / `document` を直接触るので
 * ``dynamic(() => import(...), { ssr: false })`` 経由でしか render しない。
 *
 * 端の責務: 緯度経度 string → number 変換と min radius (500m) clamp。
 * 親 (MapPreview / MapEditor) からは `{lat, lng, radius_m}` を受け取る。
 */

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import { Circle, MapContainer, TileLayer, useMap } from "react-leaflet";

import {
	RESIDENCE_MAX_RADIUS_M,
	RESIDENCE_MIN_RADIUS_M,
} from "@/lib/api/residence";

interface ResidenceCircleMapProps {
	lat: number;
	lng: number;
	radiusM: number;
	/** Map の高さ (px)。 親の grid と合わせる。 */
	height?: number;
	/** デフォルト zoom。 radius に応じて自動 fit したいときは null で渡す。 */
	zoom?: number;
	/** 編集モードでは zoom / drag を許可。 表示モードでは無効化。 */
	interactive?: boolean;
}

/**
 * radius_m から表示 zoom を決める。 円が画面に綺麗に収まる zoom レベル。
 * Leaflet の zoom は対数スケールなので log2 を使う。
 */
function zoomForRadius(radiusM: number): number {
	if (radiusM <= 600) return 14;
	if (radiusM <= 1500) return 13;
	if (radiusM <= 5_000) return 12;
	if (radiusM <= 15_000) return 11;
	if (radiusM <= 30_000) return 10;
	return 9;
}

/** Map を center / zoom に追従させる helper (react-leaflet では imperative API)。 */
function MapFollow({
	lat,
	lng,
	zoom,
}: {
	lat: number;
	lng: number;
	zoom: number;
}) {
	const map = useMap();
	useEffect(() => {
		map.setView([lat, lng], zoom, { animate: true });
	}, [lat, lng, zoom, map]);
	return null;
}

export default function ResidenceCircleMap({
	lat,
	lng,
	radiusM,
	height = 240,
	zoom,
	interactive = false,
}: ResidenceCircleMapProps) {
	const clampedRadius = useMemo(
		() =>
			Math.min(
				Math.max(radiusM, RESIDENCE_MIN_RADIUS_M),
				RESIDENCE_MAX_RADIUS_M,
			),
		[radiusM],
	);
	const effectiveZoom = zoom ?? zoomForRadius(clampedRadius);

	return (
		<div
			className="overflow-hidden rounded-lg border"
			style={{ borderColor: "var(--a-border)", height }}
		>
			<MapContainer
				center={[lat, lng]}
				zoom={effectiveZoom}
				scrollWheelZoom={interactive}
				dragging={interactive}
				doubleClickZoom={interactive}
				zoomControl={interactive}
				touchZoom={interactive}
				keyboard={interactive}
				attributionControl
				style={{ height: "100%", width: "100%" }}
			>
				<TileLayer
					attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
					url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
				/>
				<Circle
					center={[lat, lng]}
					radius={clampedRadius}
					pathOptions={{
						color: "#2563eb",
						fillColor: "#2563eb",
						fillOpacity: 0.18,
						weight: 2,
					}}
				/>
				<MapFollow lat={lat} lng={lng} zoom={effectiveZoom} />
			</MapContainer>
		</div>
	);
}
