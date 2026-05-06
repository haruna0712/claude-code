"use client";

/**
 * NotificationsList (#412 / Phase 4A).
 *
 * `/notifications` ページのメイン UI。一覧 fetch + 既読化 + 各通知 click で
 * 対象に navigate。
 *
 * 仕様: docs/specs/notifications-spec.md §7.4 / §7.5。
 */

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import {
	fetchNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationItem,
	type NotificationKind,
} from "@/lib/api/notifications";

interface NotificationsListProps {
	initialUnreadOnly?: boolean;
}

type LoadState = "loading" | "ready" | "error";

function buildHref(n: NotificationItem): string | null {
	if (n.target_type === "tweet" && n.target_id) {
		return `/tweet/${n.target_id}`;
	}
	if (n.target_type === "user" && n.actor) {
		return `/u/${n.actor.handle}`;
	}
	return null;
}

// TS-rev MED M5: 文言を 1 箇所に集約 (Phase 8 i18n 抽出を容易に)
const MESSAGES: Record<NotificationKind, (actor: string) => string> = {
	like: (a) => `${a} さんがあなたのツイートにいいねしました`,
	repost: (a) => `${a} さんがあなたのツイートをリポストしました`,
	quote: (a) => `${a} さんがあなたのツイートを引用しました`,
	reply: (a) => `${a} さんがリプライしました`,
	mention: (a) => `${a} さんがあなたをメンションしました`,
	follow: (a) => `${a} さんがあなたをフォローしました`,
	// 将来 (Phase 3 / 5) で有効化される kind は default fallback で吸収
	dm_message: (a) => `${a} さんから DM が届きました`,
	dm_invite: (a) => `${a} さんからグループ招待が届きました`,
	article_comment: (a) => `${a} さんが記事にコメントしました`,
	article_like: (a) => `${a} さんが記事にいいねしました`,
};

function describe(n: NotificationItem): string {
	const actorName =
		n.actor?.display_name?.trim() || n.actor?.handle || "削除されたユーザー";
	const f = MESSAGES[n.kind];
	return f ? f(actorName) : `${actorName} さんから通知`;
}

export default function NotificationsList({
	initialUnreadOnly = false,
}: NotificationsListProps) {
	const [items, setItems] = useState<NotificationItem[]>([]);
	const [state, setState] = useState<LoadState>("loading");
	const [unreadOnly, setUnreadOnly] = useState(initialUnreadOnly);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	// H3: もっと見る の同時連打を防ぐ guard
	const [loadingMore, setLoadingMore] = useState(false);
	const loadMoreInFlightRef = useRef(false);

	useEffect(() => {
		let cancelled = false;
		setState("loading");
		fetchNotifications({ unread_only: unreadOnly })
			.then(async (data) => {
				if (cancelled) return;
				setItems(data.results);
				setNextCursor(data.next);
				setState("ready");
				// X 流: 一覧を開いた瞬間に未読が含まれていれば一括既読化する。
				// 「すべて」「未読のみ」両方のタブで実行 (spec §7.4)。
				if (data.results.some((n) => !n.read)) {
					try {
						await markAllNotificationsRead();
					} catch {
						// silent: 失敗しても表示は継続
					}
				}
			})
			.catch(() => {
				if (cancelled) return;
				setState("error");
			});
		return () => {
			cancelled = true;
		};
	}, [unreadOnly]);

	const groupedTitle = useMemo(
		() => (unreadOnly ? "未読の通知" : "すべての通知"),
		[unreadOnly],
	);

	return (
		<section
			aria-labelledby="notifications-heading"
			className="rounded-lg border border-border bg-card"
		>
			<header className="flex items-center justify-between border-b border-border p-4">
				<h1
					id="notifications-heading"
					className="flex items-center gap-2 text-lg font-bold text-foreground"
				>
					<Bell className="size-5" aria-hidden="true" />
					{groupedTitle}
				</h1>
				{/* a11y MED: tablist + tab は tabpanel ペアが必要なので、ここは
				    通常の toggle button + aria-pressed にする (X 慣習)。 */}
				<div role="group" aria-label="フィルタ" className="flex gap-2 text-sm">
					<button
						type="button"
						aria-pressed={!unreadOnly}
						onClick={() => setUnreadOnly(false)}
						className={`rounded-full px-3 py-1 ${
							!unreadOnly
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-muted"
						}`}
					>
						すべて
					</button>
					<button
						type="button"
						aria-pressed={unreadOnly}
						onClick={() => setUnreadOnly(true)}
						className={`rounded-full px-3 py-1 ${
							unreadOnly
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-muted"
						}`}
					>
						未読のみ
					</button>
				</div>
			</header>

			{state === "loading" ? (
				<div
					role="status"
					aria-live="polite"
					className="p-8 text-center text-muted-foreground"
				>
					読み込み中…
				</div>
			) : state === "error" ? (
				<div role="alert" className="text-baby_red p-8 text-center">
					通知の取得に失敗しました
				</div>
			) : items.length === 0 ? (
				<div className="p-8 text-center text-muted-foreground">
					通知はありません
				</div>
			) : (
				<ul className="divide-y divide-border">
					{items.map((n) => {
						const href = buildHref(n);
						const message = describe(n);
						const inner = (
							<>
								<div className="flex-1">
									<p
										className={`text-sm ${
											n.read
												? "text-muted-foreground"
												: "font-semibold text-foreground"
										}`}
									>
										{message}
									</p>
									{n.target_preview && n.target_preview.type === "tweet" ? (
										<p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
											{n.target_preview.is_deleted
												? "(このツイートは削除されました)"
												: n.target_preview.body_excerpt}
										</p>
									) : null}
								</div>
								{!n.read ? (
									<span
										aria-hidden="true"
										className="ml-3 inline-block size-2 shrink-0 rounded-full bg-red-500"
									/>
								) : null}
							</>
						);
						const liClass =
							"flex items-start gap-3 p-4 transition hover:bg-muted/40";
						const handleClick = async () => {
							if (!n.read) {
								try {
									await markNotificationRead(n.id);
									setItems((prev) =>
										prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
									);
								} catch {
									// silent
								}
							}
						};
						return (
							<li key={n.id} className={liClass}>
								{href ? (
									<Link
										href={href}
										onClick={handleClick}
										className="flex w-full items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										{inner}
									</Link>
								) : (
									<div className="flex w-full items-start gap-3">{inner}</div>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{nextCursor ? (
				<div className="border-t border-border p-4 text-center">
					<button
						type="button"
						disabled={loadingMore}
						aria-busy={loadingMore}
						onClick={() => {
							// H3: in-flight guard で連打を防ぐ
							if (loadMoreInFlightRef.current) return;
							loadMoreInFlightRef.current = true;
							setLoadingMore(true);
							fetchNotifications({
								unread_only: unreadOnly,
								cursor: nextCursor,
							})
								.then((data) => {
									setItems((prev) => [...prev, ...data.results]);
									setNextCursor(data.next);
								})
								.catch(() => {
									// silent fallback
								})
								.finally(() => {
									loadMoreInFlightRef.current = false;
									setLoadingMore(false);
								});
						}}
						className="rounded-full border border-border px-6 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
					>
						{loadingMore ? "読み込み中…" : "もっと見る"}
					</button>
				</div>
			) : null}
		</section>
	);
}
