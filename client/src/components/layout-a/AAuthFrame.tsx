"use client";

/**
 * A direction Auth Frame (#556 Phase B-0-5).
 *
 * gan-evaluator Blocker 6 への対応。`/` (A direction) → 「ログイン」 → `/login`
 * で旧 shell (dark theme / devstream brand 消失) に戻る問題を解消し、auth
 * gate でも devstream brand と light theme を維持する。
 *
 * - BrandMark + 「devstream」 ヘッダ (homepage の LeftNav と同じ意匠)
 * - light bg (var(--a-bg)), centered card, cyan accent
 * - 子に form を渡すだけ。CSRF / cookie auth / form validation は子側の責務
 *   (LoginForm / RegisterForm 等を本フレームの内部で変更しない)
 */

import Link from "next/link";
import type { ReactNode } from "react";

interface AAuthFrameProps {
	title: string;
	subtitle?: ReactNode;
	children: ReactNode;
}

function BrandMark({ size = 28 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden="true"
		>
			<rect x="2" y="2" width="20" height="20" rx="5" fill="#0a0a0a" />
			<path
				d="M7 9.5h7a2.5 2.5 0 010 5h-4a2.5 2.5 0 000 5h7"
				stroke="#0ea5e9"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export default function AAuthFrame({
	title,
	subtitle,
	children,
}: AAuthFrameProps) {
	return (
		<div
			className="flex min-h-screen flex-col"
			style={{
				background: "var(--a-bg)",
				color: "var(--a-text)",
				fontFamily: "var(--a-font-sans)",
			}}
		>
			<header className="flex items-center gap-2 px-5 py-4">
				<Link
					href="/"
					aria-label="devstream ホームへ戻る"
					className="inline-flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
				>
					<BrandMark size={26} />
					<span
						className="font-semibold tracking-tight"
						style={{ fontSize: 16, color: "var(--a-text)" }}
					>
						devstream
					</span>
				</Link>
			</header>

			<main className="flex flex-1 items-center justify-center px-5 py-10">
				<section
					aria-labelledby="auth-title"
					className="w-full max-w-md rounded-xl border"
					style={{
						borderColor: "var(--a-border)",
						background: "var(--a-bg)",
						padding: "32px 28px",
					}}
				>
					<h1
						id="auth-title"
						className="text-center font-semibold tracking-tight"
						style={{
							fontSize: 22,
							letterSpacing: -0.3,
							color: "var(--a-text)",
						}}
					>
						{title}
					</h1>
					{subtitle && (
						<p
							className="mt-2 text-center"
							style={{
								color: "var(--a-text-muted)",
								fontSize: 13.5,
							}}
						>
							{subtitle}
						</p>
					)}
					<div className="mt-6">{children}</div>
				</section>
			</main>

			<footer
				className="px-5 py-4 text-center"
				style={{
					color: "var(--a-text-subtle)",
					fontFamily: "var(--a-font-mono)",
					fontSize: 11,
				}}
			>
				© devstream 2026
			</footer>
		</div>
	);
}
