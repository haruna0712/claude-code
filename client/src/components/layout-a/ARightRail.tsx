"use client";

/**
 * A direction Right Rail (#550 Phase 10 POC).
 *
 * `/workspace/staticfiles/test/parts/home-a.jsx` RightRail の Next.js 移植。
 * 320px width、light theme、border-card panel + monospace meta。
 *
 * 既存 RightSidebar の中身 (TrendingTags / WhoToFollow) を A direction の
 * frame でラップして見た目だけ揃える。
 */

import type { ReactNode } from "react";

import Link from "next/link";
import { Search } from "lucide-react";

import TrendingTags from "@/components/sidebar/TrendingTags";
import WhoToFollow from "@/components/sidebar/WhoToFollow";

function APanel({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="mb-3 rounded-lg border border-[color:var(--a-border)] bg-[color:var(--a-bg)] px-3 py-2.5">
			<div
				className="mb-1.5 text-[color:var(--a-text-subtle)] uppercase"
				style={{
					fontFamily: "var(--a-font-mono)",
					fontSize: 10.5,
					letterSpacing: 0.4,
				}}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

export default function ARightRail() {
	return (
		<aside
			aria-label="右サイドバー"
			className="hidden h-screen overflow-y-auto px-4 py-3 lg:block"
			style={{
				width: 320,
				background: "var(--a-bg-subtle)",
				fontFamily: "var(--a-font-sans)",
			}}
		>
			<Link
				href="/search"
				className="mb-3 block rounded-lg border border-[color:var(--a-border)] bg-[color:var(--a-bg)] px-3 py-2.5 transition-colors hover:border-[color:var(--a-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<div
					className="flex items-center gap-2 text-[color:var(--a-text-subtle)] uppercase"
					style={{
						fontFamily: "var(--a-font-mono)",
						fontSize: 11,
						letterSpacing: 0.4,
					}}
				>
					<Search className="size-3.5" />
					search
					<kbd
						className="ml-auto rounded border border-[color:var(--a-border)] px-1.5 py-0.5"
						style={{ fontSize: 10.5 }}
					>
						⌘K
					</kbd>
				</div>
				<div
					className="mt-1.5 text-[color:var(--a-text-subtle)]"
					style={{ fontSize: 13 }}
				>
					技術・人・記事 を検索…
				</div>
			</Link>

			<APanel title="Trending tags · 24h">
				<div className="-mx-1">
					<TrendingTags />
				</div>
			</APanel>

			<APanel title="Who to follow">
				<div className="-mx-1">
					<WhoToFollow />
				</div>
			</APanel>

			<div
				className="mt-3 px-0.5 leading-relaxed text-[color:var(--a-text-subtle)]"
				style={{ fontFamily: "var(--a-font-mono)", fontSize: 10.5 }}
			>
				about · pricing · changelog
				<br />
				privacy · terms · status
				<br />© devstream 2026
			</div>
		</aside>
	);
}
