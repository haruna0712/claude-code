"use client";

/**
 * Leaflet タイル層を 1 箇所に集約する seam (Phase 12 P12-08b, #817)。
 *
 * OSM 公式タイルは production heavy traffic で利用規約に当たるため、 将来
 * MapTiler / Protomaps / 自前 tile server に **env var だけで** 切り替えられるよう
 * URL / attribution を環境変数で差し替え可能にする (council 全員一致の seam)。
 * 既定は OSM 標準 (MVP / stg では OK)。
 *
 * 新規 map view (UserMapCanvas) はこの component を使う。 既存の
 * ResidenceCircleMap のインライン URL も将来ここへ寄せる (本 PR では新規のみ)。
 */

import { TileLayer } from "react-leaflet";

const DEFAULT_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION =
	'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export default function MapTileLayer() {
	// NEXT_PUBLIC_* は build 時に inline される。 親 (UserMapCanvas) が
	// dynamic(ssr:false) なので SSR 時には実行されない前提 — その wrapper を外すと
	// server で評価される点に注意 (typescript-reviewer MEDIUM)。
	const url = process.env.NEXT_PUBLIC_MAP_TILE_URL || DEFAULT_TILE_URL;
	const attribution =
		process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || DEFAULT_ATTRIBUTION;
	return <TileLayer url={url} attribution={attribution} />;
}
