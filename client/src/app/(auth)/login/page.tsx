"use client";

import Link from "next/link";
import { Suspense } from "react";

import { LoginForm } from "@/components/forms/auth";
import AAuthFrame from "@/components/layout-a/AAuthFrame";
import OauthButtons from "@/components/shared/OauthButtons";
import Spinner from "@/components/shared/Spinner";

export default function LoginPage() {
	return (
		<AAuthFrame
			title="ログイン"
			subtitle={
				<>
					アカウントをお持ちでない方は{" "}
					<Link
						href="/register"
						className="font-medium underline-offset-2 hover:underline"
						style={{ color: "var(--a-accent)" }}
					>
						新規登録
					</Link>
				</>
			}
		>
			<Suspense
				fallback={
					<div className="flex justify-center py-6">
						<Spinner size="md" />
					</div>
				}
			>
				<LoginForm />
			</Suspense>
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
