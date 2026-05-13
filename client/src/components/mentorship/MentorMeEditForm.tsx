"use client";

/**
 * MentorMeEditForm (P11-15).
 *
 * profile (headline / bio / experience_years / is_accepting / tags) + plans
 * (CRUD) を 1 画面で編集する。 初回 mount 時に GET /mentors/me/ で既存 profile を
 * load (404 なら新規)、 PATCH で保存。 plans は別 endpoint。
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "react-toastify";

import {
	createMyMentorPlan,
	deleteMyMentorPlan,
	getMyMentorProfile,
	listMyMentorPlans,
	updateMyMentorPlan,
	updateMyMentorProfile,
	type MentorPlanBilling,
	type MentorPlanSummary,
	type MentorProfileDetail,
} from "@/lib/api/mentor";

function describeApiError(err: unknown, fallback: string): string {
	if (err && typeof err === "object") {
		const e = err as {
			response?: { data?: Record<string, unknown> };
			message?: string;
		};
		const data = e.response?.data;
		if (data && typeof data === "object") {
			const detail = (data as { detail?: string }).detail;
			if (typeof detail === "string") return detail;
			const firstField = Object.values(data)[0];
			if (Array.isArray(firstField) && typeof firstField[0] === "string") {
				return firstField[0];
			}
		}
		if (typeof e.message === "string") return e.message;
	}
	return fallback;
}

export default function MentorMeEditForm() {
	const [loading, setLoading] = useState(true);
	const [profile, setProfile] = useState<MentorProfileDetail | null>(null);
	const [headline, setHeadline] = useState("");
	const [bio, setBio] = useState("");
	const [experience, setExperience] = useState(0);
	const [accepting, setAccepting] = useState(true);
	const [tagsInput, setTagsInput] = useState("");
	const [profileError, setProfileError] = useState<string | null>(null);
	const [profileSaving, setProfileSaving] = useState(false);

	const [plans, setPlans] = useState<MentorPlanSummary[]>([]);
	const [plansError, setPlansError] = useState<string | null>(null);
	const [newPlanTitle, setNewPlanTitle] = useState("");
	const [newPlanDesc, setNewPlanDesc] = useState("");
	const [newPlanCycle, setNewPlanCycle] =
		useState<MentorPlanBilling>("one_time");
	const [newPlanSaving, setNewPlanSaving] = useState(false);

	const tags = tagsInput
		.split(/[,\s]+/)
		.map((s) => s.trim())
		.filter(Boolean);

	const refreshProfile = useCallback(async () => {
		const p = await getMyMentorProfile();
		setProfile(p);
		if (p) {
			setHeadline(p.headline);
			setBio(p.bio);
			setExperience(p.experience_years);
			setAccepting(p.is_accepting);
			setTagsInput(p.skill_tags.map((t) => t.name).join(", "));
		}
	}, []);

	const refreshPlans = useCallback(async () => {
		const list = await listMyMentorPlans().catch(() => []);
		setPlans(list);
	}, []);

	useEffect(() => {
		(async () => {
			try {
				await refreshProfile();
				await refreshPlans();
			} finally {
				setLoading(false);
			}
		})();
	}, [refreshProfile, refreshPlans]);

	const handleProfileSubmit = async (e: FormEvent) => {
		e.preventDefault();
		setProfileError(null);
		const trimmedHead = headline.trim();
		const trimmedBio = bio.trim();
		if (!trimmedHead || !trimmedBio) {
			setProfileError("headline と bio は必須です");
			return;
		}
		setProfileSaving(true);
		try {
			await updateMyMentorProfile({
				headline: trimmedHead,
				bio: trimmedBio,
				experience_years: experience,
				is_accepting: accepting,
				skill_tag_names: tags,
			});
			toast.success("プロフィールを保存しました");
			await refreshProfile();
		} catch (err) {
			setProfileError(describeApiError(err, "保存に失敗しました"));
		} finally {
			setProfileSaving(false);
		}
	};

	const handlePlanCreate = async (e: FormEvent) => {
		e.preventDefault();
		setPlansError(null);
		const t = newPlanTitle.trim();
		const d = newPlanDesc.trim();
		if (!t || !d) {
			setPlansError("plan のタイトルと説明は必須です");
			return;
		}
		setNewPlanSaving(true);
		try {
			await createMyMentorPlan({
				title: t,
				description: d,
				billing_cycle: newPlanCycle,
			});
			toast.success("plan を追加しました");
			setNewPlanTitle("");
			setNewPlanDesc("");
			setNewPlanCycle("one_time");
			await refreshPlans();
		} catch (err) {
			setPlansError(describeApiError(err, "plan の追加に失敗しました"));
		} finally {
			setNewPlanSaving(false);
		}
	};

	const handlePlanDelete = async (planId: number) => {
		if (
			!window.confirm(
				"この plan を削除しますか? (proposal / 契約履歴は残ります)",
			)
		) {
			return;
		}
		try {
			await deleteMyMentorPlan(planId);
			toast.success("plan を削除しました");
			await refreshPlans();
		} catch (err) {
			toast.error(describeApiError(err, "削除に失敗しました"));
		}
	};

	const handlePlanToggleCycle = async (
		plan: MentorPlanSummary,
		nextCycle: MentorPlanBilling,
	) => {
		try {
			await updateMyMentorPlan(plan.id, { billing_cycle: nextCycle });
			toast.success("plan を更新しました");
			await refreshPlans();
		} catch (err) {
			toast.error(describeApiError(err, "更新に失敗しました"));
		}
	};

	if (loading) {
		return (
			<p
				role="status"
				className="text-sm text-[color:var(--a-text-muted)]"
				aria-busy="true"
			>
				読み込み中…
			</p>
		);
	}

	return (
		<div className="space-y-8">
			{/* --- profile section --- */}
			<form
				onSubmit={handleProfileSubmit}
				aria-label="mentor プロフィール編集フォーム"
				className="space-y-4 rounded-lg border border-[color:var(--a-border)] p-4"
			>
				<h2 className="text-base font-semibold">プロフィール</h2>
				{profileError && (
					<p
						role="alert"
						className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						{profileError}
					</p>
				)}
				<label className="block">
					<span className="block text-sm font-medium">
						紹介 (catch copy、 1 行)
					</span>
					<input
						type="text"
						value={headline}
						onChange={(e) => setHeadline(e.target.value)}
						maxLength={80}
						placeholder="例: AWS infra mentor / 元 SRE 10 年"
						className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</label>
				<label className="block">
					<span className="block text-sm font-medium">プロフィール本文</span>
					<textarea
						value={bio}
						onChange={(e) => setBio(e.target.value)}
						maxLength={2000}
						rows={8}
						placeholder="経歴 / 得意分野 / 過去の指導歴を Markdown で"
						className="mt-1 h-[12rem] w-full rounded border border-border bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					<p className="mt-1 text-xs text-muted-foreground">
						{bio.length} / 2000 文字
					</p>
				</label>
				<div className="flex flex-wrap items-center gap-4">
					<label className="text-sm">
						経験年数:{" "}
						<input
							type="number"
							value={experience}
							onChange={(e) =>
								setExperience(Math.max(0, Math.min(80, Number(e.target.value))))
							}
							min={0}
							max={80}
							className="ml-1 w-20 rounded border border-border bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						/>{" "}
						年
					</label>
					<label className="flex items-center gap-2 text-sm">
						<input
							type="checkbox"
							checked={accepting}
							onChange={(e) => setAccepting(e.target.checked)}
						/>
						新規受付中
					</label>
				</div>
				<label className="block">
					<span className="block text-sm font-medium">
						スキル (csv、 既存タグのみ、 最大 10 個)
					</span>
					<input
						type="text"
						value={tagsInput}
						onChange={(e) => setTagsInput(e.target.value)}
						placeholder="例: aws, django, python"
						className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					/>
					{tags.length > 0 && (
						<ul aria-label="入力中のタグ" className="mt-1 flex flex-wrap gap-1">
							{tags.map((t) => (
								<li
									key={t}
									className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
								>
									#{t}
								</li>
							))}
						</ul>
					)}
				</label>
				<button
					type="submit"
					disabled={profileSaving}
					className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{profileSaving
						? "保存中…"
						: profile
							? "プロフィールを保存"
							: "プロフィールを作成"}
				</button>
			</form>

			{/* --- plans section --- */}
			<section
				aria-label="提供 plan"
				className="space-y-4 rounded-lg border border-[color:var(--a-border)] p-4"
			>
				<h2 className="text-base font-semibold">提供 plan</h2>
				{!profile && (
					<p className="text-sm text-[color:var(--a-text-muted)]">
						先にプロフィールを保存してから plan を追加してください。
					</p>
				)}
				{profile && (
					<>
						{plans.length === 0 ? (
							<p className="text-sm text-[color:var(--a-text-muted)]">
								plan はまだありません。 下のフォームから追加してください。
							</p>
						) : (
							<ul role="list" className="space-y-2">
								{plans.map((p) => (
									<li
										key={p.id}
										className="flex items-center justify-between gap-3 rounded border border-[color:var(--a-border)] p-3 text-sm"
									>
										<div className="min-w-0 flex-1">
											<div className="flex items-baseline gap-2">
												<span className="truncate font-semibold">
													{p.title}
												</span>
												<span className="text-xs text-[color:var(--a-text-muted)]">
													({p.billing_cycle === "monthly" ? "月額" : "単発"})
												</span>
											</div>
											<p className="mt-1 whitespace-pre-wrap text-xs text-[color:var(--a-text-muted)]">
												{p.description}
											</p>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											<button
												type="button"
												onClick={() =>
													handlePlanToggleCycle(
														p,
														p.billing_cycle === "monthly"
															? "one_time"
															: "monthly",
													)
												}
												aria-label={`${p.title} の課金周期を切替`}
												className="rounded border border-[color:var(--a-border)] px-2 py-1 text-xs text-[color:var(--a-text-muted)] hover:bg-[color:var(--a-bg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--a-accent)]"
											>
												切替
											</button>
											<button
												type="button"
												onClick={() => handlePlanDelete(p.id)}
												aria-label={`${p.title} を削除`}
												className="rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-destructive"
											>
												削除
											</button>
										</div>
									</li>
								))}
							</ul>
						)}

						<form
							onSubmit={handlePlanCreate}
							aria-label="新規 plan 追加フォーム"
							className="space-y-3 border-t border-[color:var(--a-border)] pt-3"
						>
							{plansError && (
								<p
									role="alert"
									className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
								>
									{plansError}
								</p>
							)}
							<label className="block">
								<span className="block text-sm font-medium">タイトル</span>
								<input
									type="text"
									value={newPlanTitle}
									onChange={(e) => setNewPlanTitle(e.target.value)}
									maxLength={60}
									placeholder="例: AWS 60 分単発"
									className="mt-1 w-full rounded border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								/>
							</label>
							<label className="block">
								<span className="block text-sm font-medium">説明</span>
								<textarea
									value={newPlanDesc}
									onChange={(e) => setNewPlanDesc(e.target.value)}
									maxLength={1000}
									rows={4}
									placeholder="提供できる内容を 1-2 段落で"
									className="mt-1 h-[8rem] w-full rounded border border-border bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								/>
							</label>
							<fieldset>
								<legend className="block text-sm font-medium">課金周期</legend>
								<div className="mt-1 flex items-center gap-4 text-sm">
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="new-plan-cycle"
											value="one_time"
											checked={newPlanCycle === "one_time"}
											onChange={() => setNewPlanCycle("one_time")}
										/>
										単発
									</label>
									<label className="flex items-center gap-2">
										<input
											type="radio"
											name="new-plan-cycle"
											value="monthly"
											checked={newPlanCycle === "monthly"}
											onChange={() => setNewPlanCycle("monthly")}
										/>
										月額
									</label>
								</div>
							</fieldset>
							<button
								type="submit"
								disabled={newPlanSaving}
								className="rounded-full bg-primary px-5 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{newPlanSaving ? "追加中…" : "plan を追加"}
							</button>
						</form>
					</>
				)}
			</section>
		</div>
	);
}
