/**
 * /mentor/wanted/new — mentee が募集を投稿 (P11-06 / Phase 11 11-A).
 *
 * auth 必須。 PR #606 で確立した SSR auth gate と同流儀で、 cookie 未保持なら
 * /login?next=/mentor/wanted/new に redirect。
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import MentorRequestForm from "@/components/mentorship/MentorRequestForm";

export const metadata: Metadata = {
	title: "メンター募集を出す — エンジニア SNS",
	robots: { index: false },
};

export default function NewMentorRequestPage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/mentor/wanted/new");
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
					href="/mentor/wanted"
					className="rounded text-[color:var(--a-text-muted)] hover:text-[color:var(--a-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
					style={{ fontSize: 12.5 }}
				>
					← 募集一覧
				</Link>
				<div className="ml-2 min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						メンター募集を出す
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						相談したい内容を簡潔に。 mentor が提案を返してきます。
					</p>
				</div>
			</header>
			<div className="p-5">
				<MentorRequestForm />
			</div>
		</>
	);
}
