"use client";

/**
 * 居住地編集用のクリック可能 map (Phase 12 P12-02)。
 *
 * 親 component から `lat / lng / radius_m` を制御 (controlled)。 ユーザーが地図を
 * クリック / ドラッグすると `onChange({lat, lng})` を発火。 radius は slider で
 * 親が制御 (このコンポーネントは表示と click event のみ責務)。
 */

import "leaflet/dist/leaflet.css";

import { useEffect, useMemo } from "react";
import {
	Circle,
	MapContainer,
	TileLayer,
	useMap,
	useMapEvent,
} from "react-leaflet";

import {
	RESIDENCE_MAX_RADIUS_M,
	RESIDENCE_MIN_RADIUS_M,
} from "@/lib/api/residence";

interface ResidenceEditorMapProps {
	lat: number;
	lng: number;
	radiusM: number;
	height?: number;
	onChange: (next: { lat: number; lng: number }) => void;
}

function MapCenter({ lat, lng }: { lat: number; lng: number }) {
	const map = useMap();
	useEffect(() => {
		map.setView([lat, lng], map.getZoom(), { animate: true });
	}, [lat, lng, map]);
	return null;
}

function ClickHandler({
	onClick,
}: {
	onClick: (lat: number, lng: number) => void;
}) {
	// react-leaflet の useMapEvent は mount 時に handler を登録し、 component
	// re-render 時に handler を更新する仕組みがない (内部で map.on/off を直接呼ぶ)。
	// そのため `onClick` が component state を直接読むと stale closure になる。
	// ここでは親 ResidenceSettingsForm の setLat / setLng (stable な state setter)
	// しか触らないので問題なし。 onClick の signature を増やすときは注意。
	useMapEvent("click", (e) => {
		onClick(e.latlng.lat, e.latlng.lng);
	});
	return null;
}

export default function ResidenceEditorMap({
	lat,
	lng,
	radiusM,
	height = 320,
	onChange,
}: ResidenceEditorMapProps) {
	const clampedRadius = useMemo(
		() =>
			Math.min(
				Math.max(radiusM, RESIDENCE_MIN_RADIUS_M),
				RESIDENCE_MAX_RADIUS_M,
			),
		[radiusM],
	);
	return (
		<div
			className="overflow-hidden rounded-lg border"
			style={{ borderColor: "var(--a-border)", height }}
		>
			<MapContainer
				center={[lat, lng]}
				zoom={13}
				scrollWheelZoom
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
				<MapCenter lat={lat} lng={lng} />
				<ClickHandler
					onClick={(nextLat, nextLng) =>
						onChange({ lat: nextLat, lng: nextLng })
					}
				/>
			</MapContainer>
		</div>
	);
}
