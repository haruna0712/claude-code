"use client";

/**
 * ユーザー検索の地図 view 本体 (Phase 12 P12-08b, #817)。
 *
 * 現在の検索結果 (occupation / text filter 済み) のうち residence を持つ user を
 * **Circle** で地図に描画する。 プライバシー上 **中心 marker (ピン) は描かない**
 * (§11.2 — 円は user が粗く設定した範囲であって自宅点ではない)。
 *
 * クライアントオンリー: Leaflet は window/document 前提なので親 (UserMapView) が
 * ``dynamic(..., { ssr:false })`` で読み込む。
 *
 * scope (council 2026-05): pan-to-update / bbox 再取得は本 PR では作らない。
 * 描画する円に ``fitBounds`` で auto-fit するだけ。 「この area を検索」 (pan→bbox,
 * auth 必須) は follow-up issue。
 */

import "leaflet/dist/leaflet.css";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Circle, MapContainer, Popup, useMap } from "react-leaflet";

import MapTileLayer from "@/components/map/MapTileLayer";
import { occupationColor } from "@/lib/occupationColor";
import {
	RESIDENCE_MAX_RADIUS_M,
	RESIDENCE_MIN_RADIUS_M,
} from "@/lib/api/residence";
import {
	isPlottableUser,
	type UserSearchResultItem,
} from "@/lib/api/userSearch";

interface UserMapCanvasProps {
	results: UserSearchResultItem[];
	height?: number;
}

const TOKYO_STATION: [number, number] = [35.681236, 139.767125];

interface PlottedUser {
	user: UserSearchResultItem;
	lat: number;
	lng: number;
	radiusM: number;
	color: string;
}

/** residence を持ち lat/lng が有限な user だけを描画対象に正規化する。 */
function toPlotted(results: UserSearchResultItem[]): PlottedUser[] {
	const plotted: PlottedUser[] = [];
	for (const user of results) {
		// UserMapView の plottableCount と同じ述語 (空白地図防止)。
		if (!isPlottableUser(user) || !user.residence) continue;
		const lat = Number(user.residence.latitude);
		const lng = Number(user.residence.longitude);
		const radiusM = Math.min(
			Math.max(user.residence.radius_m, RESIDENCE_MIN_RADIUS_M),
			RESIDENCE_MAX_RADIUS_M,
		);
		plotted.push({
			user,
			lat,
			lng,
			radiusM,
			color: occupationColor(user.occupations[0]?.slug),
		});
	}
	return plotted;
}

/** 描画する円すべてが収まるように地図を auto-fit する (imperative Leaflet API)。 */
function FitToCircles({ plotted }: { plotted: PlottedUser[] }) {
	const map = useMap();
	useEffect(() => {
		if (plotted.length === 0) return;
		// 各円を [lat,lng] の点として bounds を作り、 余白付きで fit。
		const points = plotted.map((p) => [p.lat, p.lng] as [number, number]);
		if (points.length === 1) {
			map.setView(points[0], 13, { animate: false });
			return;
		}
		map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
	}, [plotted, map]);
	return null;
}

export default function UserMapCanvas({
	results,
	height = 520,
}: UserMapCanvasProps) {
	const plotted = useMemo(() => toPlotted(results), [results]);

	return (
		<div
			className="overflow-hidden rounded-lg border"
			style={{ borderColor: "var(--a-border)", height }}
		>
			<MapContainer
				center={TOKYO_STATION}
				zoom={11}
				// ホイール zoom は無効。 page scroll 中に地図上を通っても勝手に zoom
				// しない (scroll trap 回避、 code-reviewer MEDIUM / a11y L4)。 zoom は
				// 右上の +/- control で行える (zoomControl は既定 true)。
				scrollWheelZoom={false}
				attributionControl
				style={{ height: "100%", width: "100%" }}
			>
				<MapTileLayer />
				{plotted.map((p) => (
					<Circle
						key={p.user.user_id}
						center={[p.lat, p.lng]}
						radius={p.radiusM}
						pathOptions={{
							color: p.color,
							fillColor: p.color,
							fillOpacity: 0.22,
							weight: 2,
						}}
					>
						<Popup>
							<div className="space-y-1">
								<p className="font-semibold">
									{p.user.display_name || p.user.username}
								</p>
								<p
									className="text-xs"
									style={{ fontFamily: "var(--a-font-mono)" }}
								>
									@{p.user.username}
								</p>
								{p.user.occupations.length > 0 && (
									<p className="text-xs">
										{p.user.occupations.map((o) => o.display_name).join(" / ")}
									</p>
								)}
								<Link
									href={`/u/${p.user.username}`}
									className="text-xs text-[color:var(--a-accent-deep)] underline underline-offset-2"
								>
									プロフィールを見る
								</Link>
							</div>
						</Popup>
					</Circle>
				))}
				<FitToCircles plotted={plotted} />
			</MapContainer>
		</div>
	);
}
