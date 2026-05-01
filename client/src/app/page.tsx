// Phase 1 ランディングページ (P1-23 残作業: P0.5 smoke page を置換)。
//
// stg / 本番ともに `/` で表示される。未ログインの訪問者にプロダクト紹介と
// ログイン/新規登録の入口を提示する。Phase 2 (P2-13 ホーム TL) が実装され
// たら、ログイン済ユーザは TL にリダイレクトする条件分岐を追加する。
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "エンジニア特化型 SNS",
	description:
		"エンジニア向けの SNS。技術タグで議論を絞り込み、Markdown でツイートを書き、" +
		"OGP やシンタックスハイライトで読みやすく共有できます。",
};

export default function LandingPage() {
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
