/**
 * HeroBanner — landing hero for the public /explore page (P2-19 / Issue #191).
 *
 * Server-renderable: no client state. Provides the brand headline, tagline,
 * and primary register / login CTAs. Above-the-fold so it ships in the
 * initial paint without layout shift.
 *
 * #584 (B-1-9) で lime-500 accent を A direction cyan に置換。
 */

import Link from "next/link";

const HEADING_ID = "explore-hero-heading";

export default function HeroBanner() {
	return (
		<header aria-labelledby={HEADING_ID} className="px-6 py-16 text-center">
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
				id={HEADING_ID}
				className="mb-6 font-bold text-foreground sm:text-5xl text-4xl"
			>
				エンジニアによる、
				<span style={{ color: "var(--a-accent)" }}>エンジニアのための</span> SNS
			</h1>
			<p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-muted-foreground">
				技術タグで興味の近い人を見つけ、Markdown でコードを共有し、 OGP
				プレビューで議論を深めましょう。
			</p>

			<div className="flex flex-col justify-center gap-3 sm:flex-row">
				<Link
					href="/register"
					className="inline-flex items-center justify-center rounded-md px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ background: "var(--a-accent)" }}
				>
					新規登録する
				</Link>
				<Link
					href="/login"
					className="inline-flex items-center justify-center rounded-md border border-[color:var(--a-border)] px-6 py-3 font-semibold text-foreground transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				>
					ログイン
				</Link>
			</div>
		</header>
	);
}
