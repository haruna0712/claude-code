"use client";

/**
 * /settings/residence で使う editor (Phase 12 P12-02)。
 *
 * 初期値があれば map を中心化、 無ければ東京駅をデフォルト。 slider で半径 (500m〜50km)
 * を変えると map の円も追従。 「保存する」 で PATCH /me/residence/。
 *
 * 保存後に role=status の通知を出して「終わり」 のシグナルを画面に残す
 * (CLAUDE.md §4.5 終わりのシグナル指針)。
 */

import dynamic from "next/dynamic";
import { useState } from "react";

import {
	RESIDENCE_MAX_RADIUS_M,
	RESIDENCE_MIN_RADIUS_M,
	type UserResidence,
	deleteMyResidence,
	saveMyResidence,
} from "@/lib/api/residence";

const ResidenceEditorMap = dynamic(() => import("./ResidenceEditorMap"), {
	ssr: false,
	loading: () => (
		<div
			className="rounded-lg border bg-[color:var(--a-bg-muted)]"
			style={{ borderColor: "var(--a-border)", height: 320 }}
			aria-label="地図を読み込み中"
		/>
	),
});

// 東京駅をデフォルト中心に (未設定 user の初期 pin 用)
const DEFAULT_CENTER = { lat: 35.681236, lng: 139.767125 };

interface ResidenceSettingsFormProps {
	initialResidence: UserResidence | null;
}

type SaveStatus =
	| { kind: "idle" }
	| { kind: "saving" }
	| { kind: "saved" }
	| { kind: "deleted" }
	| { kind: "error"; message: string };

export default function ResidenceSettingsForm({
	initialResidence,
}: ResidenceSettingsFormProps) {
	const initLat = initialResidence
		? Number(initialResidence.latitude)
		: DEFAULT_CENTER.lat;
	const initLng = initialResidence
		? Number(initialResidence.longitude)
		: DEFAULT_CENTER.lng;
	const initRadius = initialResidence?.radius_m ?? 1000;

	const [lat, setLat] = useState<number>(initLat);
	const [lng, setLng] = useState<number>(initLng);
	const [radiusM, setRadiusM] = useState<number>(initRadius);
	const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });

	async function handleSave() {
		setStatus({ kind: "saving" });
		try {
			await saveMyResidence({
				latitude: lat.toFixed(6),
				longitude: lng.toFixed(6),
				radius_m: radiusM,
			});
			setStatus({ kind: "saved" });
		} catch (error: unknown) {
			setStatus({ kind: "error", message: getErrorMessage(error) });
		}
	}

	async function handleDelete() {
		setStatus({ kind: "saving" });
		try {
			await deleteMyResidence();
			setStatus({ kind: "deleted" });
		} catch (error: unknown) {
			setStatus({ kind: "error", message: getErrorMessage(error) });
		}
	}

	const km = (radiusM / 1000).toFixed(1);

	return (
		<div className="space-y-5">
			<section aria-label="居住地の地図">
				<p
					className="mb-2 text-[color:var(--a-text-muted)]"
					style={{ fontSize: 12.5 }}
				>
					地図をクリックすると円の中心が移動します。
					円の半径はスライダーで調整できます。
				</p>
				<ResidenceEditorMap
					lat={lat}
					lng={lng}
					radiusM={radiusM}
					onChange={(p) => {
						setLat(p.lat);
						setLng(p.lng);
					}}
				/>
			</section>

			<section aria-label="半径の調整">
				<div className="mb-1 flex items-baseline justify-between">
					<label
						htmlFor="residence-radius-slider"
						className="text-sm font-medium"
					>
						円の半径
					</label>
					<span
						className="text-[color:var(--a-text-muted)]"
						style={{ fontSize: 12, fontFamily: "var(--a-font-mono)" }}
					>
						{km} km ({radiusM.toLocaleString()} m)
					</span>
				</div>
				<input
					id="residence-radius-slider"
					type="range"
					min={RESIDENCE_MIN_RADIUS_M}
					max={RESIDENCE_MAX_RADIUS_M}
					step={100}
					value={radiusM}
					onChange={(e) => setRadiusM(Number(e.target.value))}
					className="w-full"
					aria-valuemin={RESIDENCE_MIN_RADIUS_M}
					aria-valuemax={RESIDENCE_MAX_RADIUS_M}
					aria-valuenow={radiusM}
				/>
				<p
					className="mt-1 text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 11 }}
				>
					プライバシー保護のため、 半径は 500m 以上の円で表示されます
					(ピンポイントは公開されません)。
				</p>
			</section>

			<section aria-label="座標 (参考)">
				<dl
					className="grid grid-cols-2 gap-2 text-[color:var(--a-text-muted)]"
					style={{ fontSize: 12 }}
				>
					<div>
						<dt>緯度</dt>
						<dd style={{ fontFamily: "var(--a-font-mono)" }}>
							{lat.toFixed(6)}
						</dd>
					</div>
					<div>
						<dt>経度</dt>
						<dd style={{ fontFamily: "var(--a-font-mono)" }}>
							{lng.toFixed(6)}
						</dd>
					</div>
				</dl>
			</section>

			<div className="flex flex-wrap items-center gap-3">
				<button
					type="button"
					onClick={handleSave}
					disabled={status.kind === "saving"}
					className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
					style={{ background: "var(--a-accent)" }}
				>
					{status.kind === "saving" ? "保存中…" : "保存する"}
				</button>
				{initialResidence && (
					<button
						type="button"
						onClick={handleDelete}
						disabled={status.kind === "saving"}
						className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-60"
						style={{ borderColor: "var(--a-border)" }}
					>
						公開を停止
					</button>
				)}
			</div>

			{status.kind === "saved" && (
				<p
					role="status"
					className="rounded-md border px-3 py-2 text-sm"
					style={{
						borderColor: "var(--a-border)",
						background: "var(--a-bg-muted)",
					}}
				>
					保存しました。 プロフィールに地図が表示されます。
				</p>
			)}
			{status.kind === "deleted" && (
				<p
					role="status"
					className="rounded-md border px-3 py-2 text-sm"
					style={{
						borderColor: "var(--a-border)",
						background: "var(--a-bg-muted)",
					}}
				>
					居住地を非公開にしました。 プロフィールから地図が消えます。
				</p>
			)}
			{status.kind === "error" && (
				<p
					role="alert"
					className="rounded-md border px-3 py-2 text-sm"
					style={{
						borderColor: "#dc2626",
						background: "#fef2f2",
						color: "#7f1d1d",
					}}
				>
					保存に失敗しました: {status.message}
				</p>
			)}
		</div>
	);
}

function getErrorMessage(error: unknown): string {
	if (typeof error !== "object" || error === null) return "Unknown error";
	const maybeAxios = error as {
		response?: { data?: unknown; status?: number };
		message?: string;
	};
	const data = maybeAxios.response?.data;
	if (typeof data === "object" && data !== null) {
		// DRF の field error 形式: {field: [msg]}
		const flat: string[] = [];
		for (const [field, msgs] of Object.entries(data)) {
			if (Array.isArray(msgs)) {
				flat.push(`${field}: ${msgs.join(", ")}`);
			} else if (typeof msgs === "string") {
				flat.push(`${field}: ${msgs}`);
			}
		}
		if (flat.length > 0) return flat.join(" / ");
	}
	return maybeAxios.message ?? "Unknown error";
}
