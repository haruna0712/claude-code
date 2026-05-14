/**
 * /  ホームページ (Phase B-1-0 #564 で (a)/page.tsx から (template)/page.tsx に移動).
 *
 * 未ログイン → ランディング (A direction の light theme)
 * ログイン済 → HomeFeed (recommended/following タイムライン) + sticky header + AComposeShell
 *
 * 既存ロジック (serverFetch + 401 fallback) はそのまま。
 */
import type { Metadata } from "next";
import Link from "next/link";

import AComposeShell from "@/components/layout-a/AComposeShell";
import HomeFeed from "@/components/timeline/HomeFeed";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { HomeTimelinePage } from "@/lib/api/timeline";
import type { CurrentUser } from "@/lib/api/users";

export const metadata: Metadata = {
	title: "エンジニア特化型 SNS",
	description:
		"エンジニア向けの SNS。技術タグで議論を絞り込み、Markdown でツイートを書き、" +
		"OGP やシンタックスハイライトで読みやすく共有できます。",
};

function Landing() {
	return (
		<div
			className="flex min-h-screen items-center justify-center px-6 py-16"
			style={{ background: "var(--a-bg)", color: "var(--a-text)" }}
		>
			<div className="max-w-2xl text-center">
				<p
					className="mb-4 uppercase tracking-widest"
					style={{
						color: "var(--a-accent)",
						fontFamily: "var(--a-font-mono)",
						fontSize: 11,
						letterSpacing: 1.2,
					}}
				>
					Engineer-Focused SNS
				</p>
				<h1
					className="mb-6 font-bold leading-tight"
					style={{ fontSize: "clamp(2rem, 1.5rem + 2vw, 3rem)" }}
				>
					エンジニアのための、{" "}
					<span style={{ color: "var(--a-accent)" }}>技術で繋がる</span> SNS
				</h1>
				<p
					className="mb-10 leading-relaxed"
					style={{ color: "var(--a-text-muted)", fontSize: 17 }}
				>
					技術タグで興味の近い人を見つけ、Markdown でコードを共有し、
					記事や掲示板で議論を深めましょう。
				</p>

				<div className="flex flex-col justify-center gap-3 sm:flex-row">
					<Link
						href="/register"
						className="inline-flex items-center justify-center rounded-md px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90"
						style={{ background: "var(--a-accent)", fontSize: 14 }}
					>
						新規登録する
					</Link>
					<Link
						href="/login"
						className="inline-flex items-center justify-center rounded-md px-6 py-3 font-semibold transition-colors"
						style={{
							border: "1px solid var(--a-border)",
							color: "var(--a-text)",
							fontSize: 14,
						}}
					>
						ログイン
					</Link>
				</div>
			</div>
		</div>
	);
}

export default async function HomePage({
	searchParams,
}: {
	searchParams?: { tab?: string };
}) {
	let user: CurrentUser | null = null;
	try {
		user = await serverFetch<CurrentUser>("/users/me/");
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 401) {
			return <Landing />;
		}
		return <Landing />;
	}

	const rawTab = searchParams?.tab;
	const initialTab =
		rawTab === "following" ? ("following" as const) : ("recommended" as const);

	let initialTweets: HomeTimelinePage["results"] = [];
	try {
		const data = await serverFetch<HomeTimelinePage>(
			`/timeline/home/?limit=20`,
		);
		initialTweets = data.results;
	} catch {
		initialTweets = [];
	}

	return (
		<>
			{/* #554: sticky top-0 で scroll しても header が固定。backdrop blur が
			    こうして初めて機能する (Phase A POC で position:sticky 抜けていた)。 */}
			<header
				className="sticky top-0 z-10 flex items-center gap-4 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<h1
					className="font-semibold tracking-tight"
					style={{ fontSize: 15, letterSpacing: -0.2 }}
				>
					ホーム
				</h1>
				<span
					className="ml-auto inline-flex items-center gap-1.5 text-[color:var(--a-text-subtle)]"
					style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
				>
					<span
						style={{
							width: 6,
							height: 6,
							borderRadius: "50%",
							background: "var(--a-success)",
						}}
					/>
					live
				</span>
			</header>
			<AComposeShell />
			<HomeFeed
				initialTab={initialTab}
				initialTweets={initialTweets}
				currentUserHandle={user.username}
				currentUserPreferredLanguage={user.preferred_language}
			/>
		</>
	);
}
