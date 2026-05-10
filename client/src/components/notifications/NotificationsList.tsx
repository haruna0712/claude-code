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

import DmInviteActions from "@/components/dm/DmInviteActions";
import {
	fetchNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	type NotificationActor,
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
	// #489: dm_invite 通知は inline action button を出すため通知 row 全体を Link に
	// 包まない (button-in-link は ARIA 非推奨)。受信箱への到達性は妥協する。
	return null;
}

function isInlineInviteRow(n: NotificationItem): boolean {
	if (n.kind !== "dm_invite") return false;
	if (n.target_type !== "invitation") return false;
	const id = Number(n.target_id);
	return Number.isInteger(id) && id > 0;
}

// #416: 主語と動詞を分離。グループ化対応で複数 actor の表示に対応。
// 動詞部分のみここに定義 (例: 「あなたのツイートにいいねしました」)。
const VERBS: Record<NotificationKind, string> = {
	like: "あなたのツイートにいいねしました",
	repost: "あなたのツイートをリポストしました",
	quote: "あなたのツイートを引用しました",
	reply: "リプライしました",
	mention: "あなたをメンションしました",
	follow: "あなたをフォローしました",
	dm_message: "から DM が届きました",
	dm_invite: "からグループ招待が届きました",
	article_comment: "が記事にコメントしました",
	article_like: "が記事にいいねしました",
};

function actorName(actor: NotificationActor | null | undefined): string {
	if (!actor) return "削除されたユーザー";
	return (actor.display_name?.trim() || actor.handle) ?? "削除されたユーザー";
}

function describe(n: NotificationItem): string {
	// 互換性: actors が無い古いレスポンスは actor 単独で扱う
	const list: NotificationActor[] =
		n.actors && n.actors.length > 0 ? n.actors : n.actor ? [n.actor] : [];
	const visibleNames = list.slice(0, 3).map((a) => `${actorName(a)} さん`);
	const remaining = (n.actor_count ?? list.length) - visibleNames.length;
	const subjects =
		remaining > 0 ? [...visibleNames, `他 ${remaining} 人`] : visibleNames;
	const subject = subjects.join("、") || "削除されたユーザー さん";
	const verb = VERBS[n.kind] ?? "から通知";
	return `${subject}が${verb}`;
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
						const showInlineInvite = isInlineInviteRow(n);
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
						const markRead = async () => {
							if (n.read) return;
							// #416: グループ全 row を一括既読化 (row_ids が無い古い shape は
							// id 単独で fallback)
							const ids =
								n.row_ids && n.row_ids.length > 0 ? n.row_ids : [n.id];
							try {
								await Promise.all(ids.map((id) => markNotificationRead(id)));
								setItems((prev) =>
									prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
								);
							} catch {
								// silent
							}
						};
						if (showInlineInvite) {
							// #489: dm_invite 通知は inline 承諾/拒否 button を出す。
							// resolved 後は listing から row を remove + read 化。
							const onResolved = (_kind: "accepted" | "declined") => {
								setItems((prev) => prev.filter((x) => x.id !== n.id));
								markRead().catch(() => undefined);
							};
							return (
								<li key={n.id} className={liClass}>
									<div className="flex w-full items-start gap-3">{inner}</div>
									<DmInviteActions
										invitationId={Number(n.target_id)}
										onResolved={onResolved}
									/>
								</li>
							);
						}
						return (
							<li key={n.id} className={liClass}>
								{href ? (
									<Link
										href={href}
										onClick={markRead}
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
