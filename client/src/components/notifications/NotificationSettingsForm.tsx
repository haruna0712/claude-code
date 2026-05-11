"use client";

/**
 * NotificationSettingsForm (#415).
 *
 * 通知の種別 ON/OFF を toggle する form。各 kind ごとに `ToggleSwitch` を並べ、
 * click で楽観 UI 更新 + PATCH。失敗時は rollback + toast.error。
 *
 * 仕様: docs/specs/notification-settings-spec.md §7。
 */

import { useEffect, useState } from "react";
import { toast } from "react-toastify";

import ToggleSwitch from "@/components/ui/toggle-switch";
import {
	fetchNotificationSettings,
	updateNotificationSetting,
	type NotificationKind,
	type NotificationSettingItem,
} from "@/lib/api/notifications";

type LoadState = "loading" | "ready" | "error";

/** 表示する kind と日本語 label / 補足。本 Issue で actively configurable な
 * 6 種は active=true、将来配線される 4 種は active=false で disabled 表示。 */
const KIND_LABELS: Record<
	NotificationKind,
	{ label: string; description?: string; active: boolean }
> = {
	like: { label: "いいね", active: true },
	repost: { label: "リポスト", active: true },
	quote: { label: "引用", active: true },
	reply: { label: "リプライ", active: true },
	mention: { label: "メンション", active: true },
	follow: { label: "新しいフォロワー", active: true },
	dm_message: {
		label: "DM",
		description: "Phase 3 完了後に有効化",
		active: false,
	},
	dm_invite: {
		label: "グループ招待",
		description: "Phase 3 完了後に有効化",
		active: false,
	},
	article_comment: {
		label: "記事コメント",
		description: "Phase 5 完了後に有効化",
		active: false,
	},
	article_like: {
		label: "記事へのいいね",
		description: "Phase 5 完了後に有効化",
		active: false,
	},
};

const KIND_ORDER: NotificationKind[] = [
	"like",
	"repost",
	"quote",
	"reply",
	"mention",
	"follow",
	"dm_message",
	"dm_invite",
	"article_comment",
	"article_like",
];

export default function NotificationSettingsForm() {
	const [items, setItems] = useState<NotificationSettingItem[]>([]);
	const [state, setState] = useState<LoadState>("loading");

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		fetchNotificationSettings()
			.then((rows) => {
				if (cancelled) return;
				setItems(rows);
				setState("ready");
			})
			.catch(() => {
				if (cancelled) return;
				setState("error");
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const handleToggle = async (kind: NotificationKind, current: boolean) => {
		const next = !current;
		// 楽観 UI
		setItems((prev) =>
			prev.map((it) => (it.kind === kind ? { ...it, enabled: next } : it)),
		);
		try {
			await updateNotificationSetting(kind, next);
		} catch {
			// rollback
			setItems((prev) =>
				prev.map((it) => (it.kind === kind ? { ...it, enabled: current } : it)),
			);
			toast.error("設定の更新に失敗しました");
		}
	};

	if (state === "loading") {
		return (
			<div
				role="status"
				aria-live="polite"
				className="p-8 text-center text-muted-foreground"
			>
				読み込み中…
			</div>
		);
	}
	if (state === "error") {
		return (
			<div
				role="alert"
				className="p-8 text-center text-[color:var(--a-danger)]"
			>
				通知設定の取得に失敗しました
			</div>
		);
	}

	const byKind = new Map(items.map((it) => [it.kind, it]));

	return (
		<section
			aria-labelledby="notif-settings-heading"
			className="rounded-lg border border-border bg-card"
		>
			<header className="border-b border-border p-4">
				{/* #577: page wrapper の sticky <h1>「通知の設定」 が page heading なので、
				    NotificationSettingsForm 内部は <h2> に降格 (1 page 1 h1)。 */}
				<h2
					id="notif-settings-heading"
					className="text-lg font-bold text-foreground"
				>
					通知の設定
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					種別ごとに通知の受け取りを ON/OFF できます。OFF
					にすると、その種別の通知は作成されません。
				</p>
			</header>
			<ul className="divide-y divide-border">
				{KIND_ORDER.map((kind) => {
					const item = byKind.get(kind);
					const meta = KIND_LABELS[kind];
					const enabled = item?.enabled ?? true;
					return (
						<li
							key={kind}
							className="flex items-center justify-between gap-4 p-4"
						>
							<div className="min-w-0 flex-1">
								<p className="text-sm font-medium text-foreground">
									{meta.label}
								</p>
								{meta.description ? (
									<p className="mt-0.5 text-xs text-muted-foreground">
										{meta.description}
									</p>
								) : null}
							</div>
							<ToggleSwitch
								checked={enabled}
								onCheckedChange={() => handleToggle(kind, enabled)}
								disabled={!meta.active}
								aria-label={`${meta.label} の通知`}
							/>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
