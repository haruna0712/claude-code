/**
 * /mentor/contracts/me — 自分の契約一覧 (P11-18 / Phase 11-C).
 *
 * auth 必須。 SSR で list を fetch、 mentee tab / mentor tab で切替表示。
 *
 * spec §7
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { type MentorshipContractDetail } from "@/lib/api/mentor";
import { serverFetch, ApiServerError } from "@/lib/api/server";

export const metadata: Metadata = {
	title: "メンタリング契約一覧 — エンジニア SNS",
	robots: { index: false },
};

interface PageProps {
	searchParams?: { role?: string };
}

type Role = "all" | "mentee" | "mentor";

function resolveRole(raw: string | undefined): Role {
	if (raw === "mentee") return "mentee";
	if (raw === "mentor") return "mentor";
	return "all";
}

async function fetchContracts(role: Role): Promise<MentorshipContractDetail[]> {
	try {
		const path =
			role === "all"
				? "/mentor/contracts/me/"
				: `/mentor/contracts/me/?role=${role}`;
		return await serverFetch<MentorshipContractDetail[]>(path);
	} catch (err) {
		if (err instanceof ApiServerError) return [];
		return [];
	}
}

export default async function ContractsMePage({ searchParams }: PageProps) {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/mentor/contracts/me");
	}

	const role = resolveRole(searchParams?.role);
	const contracts = await fetchContracts(role);

	const tabs: { key: Role; label: string; href: string }[] = [
		{ key: "all", label: "すべて", href: "/mentor/contracts/me" },
		{
			key: "mentee",
			label: "教わる側",
			href: "/mentor/contracts/me?role=mentee",
		},
		{
			key: "mentor",
			label: "教える側",
			href: "/mentor/contracts/me?role=mentor",
		},
	];

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
				<div className="min-w-0 flex-1">
					<h1
						className="truncate font-semibold tracking-tight"
						style={{ fontSize: 15, letterSpacing: -0.2 }}
					>
						メンタリング契約
					</h1>
					<p
						className="truncate text-[color:var(--a-text-subtle)]"
						style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
					>
						{role === "mentee"
							? "あなたが教わる契約"
							: role === "mentor"
								? "あなたが教える契約"
								: "成立済の契約 (mentee + mentor 両方)"}
					</p>
				</div>
			</header>

			<nav
				aria-label="契約 role タブ"
				className="mt-2 flex border-b border-[color:var(--a-border)] px-4"
			>
				{tabs.map((t) => (
					<Link
						key={t.key}
						href={t.href}
						aria-current={role === t.key ? "page" : undefined}
						className={`relative px-4 py-2 text-sm font-medium transition ${
							role === t.key
								? "text-[color:var(--a-text)]"
								: "text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-muted)]"
						}`}
					>
						{t.label}
						{role === t.key ? (
							<span
								aria-hidden="true"
								className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
								style={{ background: "var(--a-accent)" }}
							/>
						) : null}
					</Link>
				))}
			</nav>

			<div className="p-5">
				{contracts.length === 0 ? (
					<p className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]">
						契約がありません。
					</p>
				) : (
					<ul role="list" className="grid gap-3">
						{contracts.map((c) => (
							<li key={c.id}>
								<ContractCard contract={c} />
							</li>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

function ContractCard({ contract }: { contract: MentorshipContractDetail }) {
	const statusLabel =
		contract.status === "active"
			? "進行中"
			: contract.status === "completed"
				? "完了"
				: "キャンセル";
	return (
		<Link
			href={`/mentor/contracts/${contract.id}`}
			aria-label={`契約 #${contract.id} を開く`}
			className="block rounded-lg border border-[color:var(--a-border)] p-4 transition-colors hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
		>
			<div className="flex items-center gap-2 text-xs text-[color:var(--a-text-muted)]">
				<span>#{contract.id}</span>
				<span aria-hidden="true">·</span>
				<span>{statusLabel}</span>
				<span aria-hidden="true">·</span>
				<time dateTime={contract.started_at}>
					{new Date(contract.started_at).toLocaleDateString("ja-JP")}
				</time>
			</div>
			<p className="mt-1 text-sm">
				<span className="text-[color:var(--a-text-muted)]">mentee:</span>{" "}
				<span className="font-semibold">@{contract.mentee.handle}</span>{" "}
				<span className="text-[color:var(--a-text-muted)]">/ mentor:</span>{" "}
				<span className="font-semibold">@{contract.mentor.handle}</span>
			</p>
		</Link>
	);
}
