// `/` ルート: 未ログインなら Phase 1 ランディング、ログイン済なら Twitter 風の
// ホーム TL を表示する (P2-13 ホーム TL UI)。
//
// 認証判定は `/users/me/` に SSR で fetch して 401 か 200 かで分ける。serverFetch
// は Cookie を next/headers 経由で Django にそのまま forward するので、JWT 期限
// 切れ時は 401 が返って Landing にフォールバックする (browser 側で refresh が
// 走った後に再 nav すれば feed に切り替わる)。
import type { Metadata } from "next";
import Link from "next/link";

import HomeFeed from "@/components/timeline/HomeFeed";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import type { TweetSummary } from "@/lib/api/tweets";

export const metadata: Metadata = {
	title: "エンジニア特化型 SNS",
	description:
		"エンジニア向けの SNS。技術タグで議論を絞り込み、Markdown でツイートを書き、" +
		"OGP やシンタックスハイライトで読みやすく共有できます。",
};

interface CurrentUser {
	id: string;
	username: string;
	email: string;
	is_active: boolean;
}

interface TweetListPage {
	count: number;
	next: string | null;
	previous: string | null;
	results: TweetSummary[];
}

async function loadCurrentUserSafe(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch (error) {
		if (error instanceof ApiServerError && error.status === 401) return null;
		// 401 以外 (network / 500 等) は Landing にフォールバックして
		// アプリが完全停止しないようにする。
		return null;
	}
}

async function loadHomeTimeline(): Promise<TweetSummary[]> {
	try {
		const page = await serverFetch<TweetListPage | TweetSummary[]>(
			"/timeline/home/",
		);
		// Timeline view は plain array を返す可能性も List Page paging を返す可能性も
		// あるので両対応する。
		if (Array.isArray(page)) return page;
		return page.results ?? [];
	} catch {
		return [];
	}
}

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
					stg 環境 / Phase 1 ランディング
				</p>
			</div>
		</main>
	);
}

export default async function HomePage() {
	const me = await loadCurrentUserSafe();
	if (!me) return <Landing />;

	const tweets = await loadHomeTimeline();
	return <HomeFeed initialTweets={tweets} />;
}
