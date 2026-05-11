"use client";

import Link from "next/link";

import RegisterForm from "@/components/forms/auth/RegisterForm";
import AAuthFrame from "@/components/layout-a/AAuthFrame";
import OauthButtons from "@/components/shared/OauthButtons";

export default function RegisterPage() {
	return (
		<AAuthFrame
			title="新規登録"
			subtitle={
				<>
					すでにアカウントをお持ちの方は{" "}
					<Link
						href="/login"
						className="font-medium underline-offset-2 hover:underline"
						style={{ color: "var(--a-accent)" }}
					>
						ログイン
					</Link>
				</>
			}
		>
			<RegisterForm />
			<div className="mt-5 flex items-center gap-2">
				<div
					className="h-px flex-1"
					style={{ background: "var(--a-border)" }}
				/>
				<span
					className="px-2"
					style={{ color: "var(--a-text-subtle)", fontSize: 12 }}
				>
					または
				</span>
				<div
					className="h-px flex-1"
					style={{ background: "var(--a-border)" }}
				/>
			</div>
			<OauthButtons />
		</AAuthFrame>
	);
}
