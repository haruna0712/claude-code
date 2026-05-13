"use client";

/**
 * 近所検索 toggle + radius slider (Phase 12 P12-05)。
 *
 * Server Component の page から渡される current の near_me / radius_km を初期値に、
 * 操作されたら ``router.push("/search/users?q=&near_me=1&radius_km=N")`` で
 * navigate する。
 *
 * 制約:
 * - near_me=1 は要 auth + 自分 residence が必要 → backend が 400 を返したら
 *   page 側で error 表示。 ここではボタンだけ。
 * - radius は client 側でも 1〜100 km に clamp (backend は 200 km max だが UX は 100 で十分)。
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
	PROXIMITY_RADIUS_DEFAULT_KM,
	PROXIMITY_RADIUS_MAX_KM,
	PROXIMITY_RADIUS_MIN_KM,
} from "@/lib/api/userSearch";

interface NearMeFilterProps {
	query: string;
	initialNearMe: boolean;
	initialRadiusKm: number;
	/** 「ログイン必須」 を出す必要があるかどうか。 page 側で current user を見て判定。 */
	loggedIn: boolean;
}

export default function NearMeFilter({
	query,
	initialNearMe,
	initialRadiusKm,
	loggedIn,
}: NearMeFilterProps) {
	const router = useRouter();
	const [nearMe, setNearMe] = useState(initialNearMe);
	const [radiusKm, setRadiusKm] = useState(initialRadiusKm);

	function navigate(next: { nearMe: boolean; radiusKm: number }) {
		const params = new URLSearchParams();
		if (query) params.set("q", query);
		if (next.nearMe) {
			params.set("near_me", "1");
			params.set("radius_km", String(next.radiusKm));
		}
		const qs = params.toString();
		router.push(qs ? `/search/users?${qs}` : "/search/users");
	}

	return (
		<div
			className="rounded-md border border-[color:var(--a-border)] px-3 py-2"
			style={{ background: "var(--a-bg-muted)" }}
		>
			<div className="flex flex-wrap items-center gap-3">
				<label className="flex cursor-pointer items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={nearMe}
						disabled={!loggedIn}
						onChange={(e) => {
							const checked = e.target.checked;
							setNearMe(checked);
							navigate({ nearMe: checked, radiusKm });
						}}
					/>
					{/* 視覚ラベルと screen reader 名称を一致させる: 単一の <span> が
					    wrapping <label> で checkbox の accessible name になるので
					    別途 aria-label を付けない。 */}
					<span>自分の近所で絞り込む</span>
				</label>

				{!loggedIn && (
					<span
						className="text-[color:var(--a-text-muted)]"
						style={{ fontSize: 11.5 }}
					>
						ログインすると自分の居住地から近い順に並べ替えできます
					</span>
				)}

				{nearMe && loggedIn && (
					<div className="flex flex-1 items-center gap-2">
						<label
							htmlFor="proximity-radius-slider"
							className="text-[color:var(--a-text-muted)]"
							style={{ fontSize: 12 }}
						>
							半径
						</label>
						<input
							id="proximity-radius-slider"
							type="range"
							min={PROXIMITY_RADIUS_MIN_KM}
							max={PROXIMITY_RADIUS_MAX_KM}
							step={1}
							value={radiusKm}
							onChange={(e) => setRadiusKm(Number(e.target.value))}
							onMouseUp={() => navigate({ nearMe, radiusKm })}
							onTouchEnd={() => navigate({ nearMe, radiusKm })}
							onKeyUp={(e) => {
								// 矢印キー = slider 値変更後の commit。 Enter / Space
								// = 明示 commit。 PageUp / PageDown / Home / End も
								// native range の操作に含まれるので拾う。
								const commitKeys = [
									"Enter",
									" ",
									"ArrowLeft",
									"ArrowRight",
									"ArrowUp",
									"ArrowDown",
									"PageUp",
									"PageDown",
									"Home",
									"End",
								];
								if (commitKeys.includes(e.key)) {
									navigate({ nearMe, radiusKm });
								}
							}}
							className="flex-1"
							aria-valuemin={PROXIMITY_RADIUS_MIN_KM}
							aria-valuemax={PROXIMITY_RADIUS_MAX_KM}
							aria-valuenow={radiusKm}
						/>
						<span
							className="shrink-0 text-[color:var(--a-text-muted)]"
							style={{
								fontFamily: "var(--a-font-mono)",
								fontSize: 12,
								minWidth: 56,
								textAlign: "right",
							}}
						>
							{radiusKm} km
						</span>
					</div>
				)}
			</div>
		</div>
	);
}
