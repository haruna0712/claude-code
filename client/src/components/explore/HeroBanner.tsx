/**
 * HeroBanner — landing hero for the public /explore page (P2-19 / Issue #191).
 *
 * Server-renderable: no client state. Provides the brand headline, tagline,
 * and primary register / login CTAs. Above-the-fold so it ships in the
 * initial paint without layout shift.
 */

import Link from "next/link";

const HEADING_ID = "explore-hero-heading";

export default function HeroBanner() {
	return (
		<header aria-labelledby={HEADING_ID} className="px-6 py-16 text-center">
			<p className="text-xs uppercase tracking-widest text-lime-500 mb-4">
				Engineer-Focused SNS
			</p>
			<h1
				id={HEADING_ID}
				className="text-4xl sm:text-5xl font-bold mb-6 text-foreground"
			>
				エンジニアによる、
				<span className="text-lime-500">エンジニアのための</span> SNS
			</h1>
			<p className="text-lg text-muted-foreground mb-10 mx-auto max-w-2xl leading-relaxed">
				技術タグで興味の近い人を見つけ、Markdown でコードを共有し、 OGP
				プレビューで議論を深めましょう。
			</p>

			<div className="flex flex-col sm:flex-row gap-3 justify-center">
				<Link
					href="/register"
					className="inline-flex items-center justify-center px-6 py-3 rounded-md bg-lime-500 text-black font-semibold hover:bg-lime-400 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					新規登録する
				</Link>
				<Link
					href="/login"
					className="inline-flex items-center justify-center px-6 py-3 rounded-md border border-border text-foreground font-semibold hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					ログイン
				</Link>
			</div>
		</header>
	);
}
