// ホームページ (P2-13 / Issue #186).
//
// 未ログイン → 既存 Phase 1 ランディングを表示。
// ログイン済 → HomeFeed (recommended/following タイムライン) を表示。
// 認証以外のエラー (network / 500) → ランディングにフォールバック。
import type { Metadata } from "next";
import Link from "next/link";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { CurrentUser } from "@/lib/api/users";
import type { HomeTimelinePage } from "@/lib/api/timeline";
import HomeFeed from "@/components/timeline/HomeFeed";

export const metadata: Metadata = {
	title: "エンジニア特化型 SNS",
	description:
		"エンジニア向けの SNS。技術タグで議論を絞り込み、Markdown でツイートを書き、" +
		"OGP やシンタックスハイライトで読みやすく共有できます。",
};

// ---------------------------------------------------------------------------
// ランディングページコンポーネント (未ログイン時 & フォールバック)
// ---------------------------------------------------------------------------

function Landing() {
	return (
		<main className="min-h-screen flex items-center justify-center px-6 py-16 bg-baby_richBlack">
			<div className="max-w-2xl text-center">
				<p className="text-xs uppercase tracking-widest text-lime-500 mb-4">
					Engineer-Focused SNS
				</p>
				<h1 className="text-4xl sm:text-5xl font-bold text-veryBlack dark:text-babyPowder mb-6">
					エンジニアのための、{" "}
					<span className="text-lime-500">技術で繋がる</span> SNS
				</h1>
				<p className="text-lg text-veryBlack/80 dark:text-babyPowder/80 mb-10 leading-relaxed">
					技術タグで興味の近い人を見つけ、Markdown でコードを共有し、 OGP
					プレビューで議論を深めましょう。
				</p>

				<div className="flex flex-col sm:flex-row gap-3 justify-center">
					<Link
						href="/register"
						className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-lime-500 text-veryBlack font-semibold hover:bg-lime-400 transition-colors"
					>
						新規登録する
					</Link>
					<Link
						href="/login"
						className="inline-flex items-center justify-center px-6 py-3 rounded-md border border-veryBlack/20 dark:border-babyPowder/20 text-veryBlack dark:text-babyPowder font-semibold hover:bg-veryBlack/5 dark:hover:bg-babyPowder/5 transition-colors"
					>
						ログイン
					</Link>
				</div>

				<p className="mt-12 text-xs text-veryBlack/50 dark:text-babyPowder/50">
					stg 環境 / Phase 1 ランディング (Phase 2 でホーム TL に置換予定)
				</p>
			</div>
		</main>
	);
}

// ---------------------------------------------------------------------------
// メインページコンポーネント
// ---------------------------------------------------------------------------

export default async function HomePage({
	searchParams,
}: {
	searchParams?: { tab?: string };
}) {
	// SSR でログイン状態を確認する。401 = 未ログイン、他エラーはフォールバック。
	let user: CurrentUser | null = null;
	try {
		user = await serverFetch<CurrentUser>("/users/me/");
	} catch (err) {
		if (err instanceof ApiServerError && err.status === 401) {
			// 未ログイン — ランディングを表示
			return <Landing />;
		}
		// network / 500 などは安全にランディングにフォールバック
		return <Landing />;
	}

	// ログイン済み — タイムラインをプリフェッチ
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
		// タイムライン取得失敗はクライアント側で再フェッチすればよい
		initialTweets = [];
	}

	return (
		<main className="min-h-screen max-w-2xl mx-auto">
			<HomeFeed initialTab={initialTab} initialTweets={initialTweets} />
		</main>
	);
}
