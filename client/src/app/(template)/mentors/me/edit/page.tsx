/**
 * /mentors/me/edit — mentor profile + plans の編集画面 (P11-15 / Phase 11-B).
 *
 * auth 必須 (SSR auth gate)。 client-side で form state を保持し、 PATCH /
 * POST / DELETE を呼ぶ。 profile 未作成なら空 form から start (PATCH で
 * auto-create)。
 *
 * spec §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import MentorMeEditForm from "@/components/mentorship/MentorMeEditForm";

export const metadata: Metadata = {
	title: "メンタープロフィール編集 — エンジニア SNS",
	robots: { index: false },
};

export default function MentorMeEditPage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/mentors/me/edit");
	}
	return (
		<>
			<header
				className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3"
				style={{
					borderBottom: "1px solid var(--a-border)",
					background: "rgba(255,255,255,0.85)",
					backdropFilter: "blur(8px)",
				}}
			>
				<Link
					href="/mentors"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← メンター一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						メンタープロフィール編集
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						あなたが mentor として受け付ける内容を設定します
					</p>
				</div>
			</header>
			<div className="p-5">
				<MentorMeEditForm />
			</div>
		</>
	);
}
