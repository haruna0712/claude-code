/**
 * Mentor 募集 board API client (Phase 11 11-A).
 *
 * spec: docs/specs/phase-11-mentor-board-spec.md §6.1, §6.2
 */

import type { AxiosInstance } from "axios";

import { api } from "./client";

export type MentorRequestStatus = "open" | "matched" | "closed" | "expired";

export type MentorProposalStatus =
	| "pending"
	| "accepted"
	| "rejected"
	| "withdrawn";

export type MentorshipContractStatus = "active" | "completed" | "canceled";

export interface MentorMiniUser {
	handle: string;
	display_name: string;
	avatar_url: string;
}

export interface MentorTagSlim {
	name: string;
	display_name: string;
}

export interface MentorRequestSummary {
	id: number;
	mentee: MentorMiniUser;
	title: string;
	target_skill_tags: MentorTagSlim[];
	budget_jpy: number;
	status: MentorRequestStatus;
	proposal_count: number;
	expires_at: string;
	created_at: string;
}

export interface MentorRequestDetail extends MentorRequestSummary {
	body: string;
	updated_at: string;
}

export interface MentorProposal {
	id: number;
	request: number;
	mentor: MentorMiniUser;
	body: string;
	status: MentorProposalStatus;
	responded_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface MentorshipContractDetail {
	id: number;
	proposal: number;
	mentee: MentorMiniUser;
	mentor: MentorMiniUser;
	plan_snapshot: Record<string, unknown>;
	status: MentorshipContractStatus;
	room_id: number;
	started_at: string;
	completed_at: string | null;
	is_paid: boolean;
	paid_amount_jpy: number;
	updated_at: string;
}

interface PageResponse<T> {
	results: T[];
	next: string | null;
	previous: string | null;
}

export async function listMentorRequests(
	params: { tag?: string; cursor?: string } = {},
	client: AxiosInstance = api,
): Promise<PageResponse<MentorRequestSummary>> {
	const qs = new URLSearchParams();
	if (params.tag) qs.set("tag", params.tag);
	if (params.cursor) qs.set("cursor", params.cursor);
	const path =
		qs.toString().length > 0
			? `/mentor/requests/?${qs.toString()}`
			: "/mentor/requests/";
	const res = await client.get<PageResponse<MentorRequestSummary>>(path);
	return res.data;
}

export async function getMentorRequest(
	pk: number,
	client: AxiosInstance = api,
): Promise<MentorRequestDetail> {
	const res = await client.get<MentorRequestDetail>(`/mentor/requests/${pk}/`);
	return res.data;
}

export interface CreateMentorRequestInput {
	title: string;
	body: string;
	target_skill_tag_names?: string[];
	budget_jpy?: number;
}

export async function createMentorRequest(
	input: CreateMentorRequestInput,
	client: AxiosInstance = api,
): Promise<MentorRequestDetail> {
	const res = await client.post<MentorRequestDetail>(
		"/mentor/requests/",
		input,
	);
	return res.data;
}

export async function createMentorProposal(
	requestId: number,
	body: string,
	client: AxiosInstance = api,
): Promise<MentorProposal> {
	const res = await client.post<MentorProposal>(
		`/mentor/requests/${requestId}/proposals/`,
		{ body },
	);
	return res.data;
}

export async function acceptMentorProposal(
	proposalId: number,
	client: AxiosInstance = api,
): Promise<MentorshipContractDetail> {
	const res = await client.post<MentorshipContractDetail>(
		`/mentor/proposals/${proposalId}/accept/`,
	);
	return res.data;
}

// --- /mentors/ (Phase 11-B) ---

export type MentorPlanBilling = "one_time" | "monthly";

export interface MentorPlanSummary {
	id: number;
	title: string;
	description: string;
	price_jpy: number;
	billing_cycle: MentorPlanBilling;
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export interface MentorProfileDetail {
	id: number;
	user: MentorMiniUser;
	headline: string;
	bio: string;
	experience_years: number;
	is_accepting: boolean;
	skill_tags: MentorTagSlim[];
	plans: MentorPlanSummary[];
	proposal_count: number;
	contract_count: number;
	avg_rating: string | null;
	review_count: number;
	created_at: string;
	updated_at: string;
}

export async function listMentors(
	params: { tag?: string; accepting?: "all"; cursor?: string } = {},
	client: AxiosInstance = api,
): Promise<PageResponse<MentorProfileDetail>> {
	const qs = new URLSearchParams();
	if (params.tag) qs.set("tag", params.tag);
	if (params.accepting) qs.set("accepting", params.accepting);
	if (params.cursor) qs.set("cursor", params.cursor);
	const path =
		qs.toString().length > 0 ? `/mentors/?${qs.toString()}` : "/mentors/";
	const res = await client.get<PageResponse<MentorProfileDetail>>(path);
	return res.data;
}

export async function getMentorByHandle(
	handle: string,
	client: AxiosInstance = api,
): Promise<MentorProfileDetail> {
	const res = await client.get<MentorProfileDetail>(`/mentors/${handle}/`);
	return res.data;
}

// --- /mentors/me/ self-edit (Phase 11-B P11-15) ---

export interface UpdateMentorProfileInput {
	headline: string;
	bio: string;
	experience_years: number;
	is_accepting: boolean;
	skill_tag_names?: string[];
}

export async function getMyMentorProfile(
	client: AxiosInstance = api,
): Promise<MentorProfileDetail | null> {
	try {
		const res = await client.get<MentorProfileDetail>("/mentors/me/");
		return res.data;
	} catch (err) {
		const e = err as { response?: { status?: number } };
		if (e.response?.status === 404) return null;
		throw err;
	}
}

export async function updateMyMentorProfile(
	input: UpdateMentorProfileInput,
	client: AxiosInstance = api,
): Promise<MentorProfileDetail> {
	const res = await client.patch<MentorProfileDetail>("/mentors/me/", input);
	return res.data;
}

export interface MentorPlanInput {
	title: string;
	description: string;
	price_jpy?: number;
	billing_cycle: MentorPlanBilling;
}

export async function listMyMentorPlans(
	client: AxiosInstance = api,
): Promise<MentorPlanSummary[]> {
	const res = await client.get<MentorPlanSummary[]>("/mentors/me/plans/");
	return res.data;
}

export async function createMyMentorPlan(
	input: MentorPlanInput,
	client: AxiosInstance = api,
): Promise<MentorPlanSummary> {
	const res = await client.post<MentorPlanSummary>("/mentors/me/plans/", input);
	return res.data;
}

export async function updateMyMentorPlan(
	planId: number,
	input: Partial<MentorPlanInput>,
	client: AxiosInstance = api,
): Promise<MentorPlanSummary> {
	const res = await client.patch<MentorPlanSummary>(
		`/mentors/me/plans/${planId}/`,
		input,
	);
	return res.data;
}

export async function deleteMyMentorPlan(
	planId: number,
	client: AxiosInstance = api,
): Promise<void> {
	await client.delete(`/mentors/me/plans/${planId}/`);
}

// --- MentorshipContract (Phase 11-C P11-18) ---

export async function listMyContracts(
	params: { role?: "mentee" | "mentor" } = {},
	client: AxiosInstance = api,
): Promise<MentorshipContractDetail[]> {
	const qs = new URLSearchParams();
	if (params.role) qs.set("role", params.role);
	const path =
		qs.toString().length > 0
			? `/mentor/contracts/me/?${qs.toString()}`
			: "/mentor/contracts/me/";
	const res = await client.get<MentorshipContractDetail[]>(path);
	return res.data;
}

export async function getMentorshipContract(
	id: number,
	client: AxiosInstance = api,
): Promise<MentorshipContractDetail> {
	const res = await client.get<MentorshipContractDetail>(
		`/mentor/contracts/${id}/`,
	);
	return res.data;
}

export async function completeContract(
	id: number,
	client: AxiosInstance = api,
): Promise<MentorshipContractDetail> {
	const res = await client.post<MentorshipContractDetail>(
		`/mentor/contracts/${id}/complete/`,
	);
	return res.data;
}

export async function cancelContract(
	id: number,
	client: AxiosInstance = api,
): Promise<MentorshipContractDetail> {
	const res = await client.post<MentorshipContractDetail>(
		`/mentor/contracts/${id}/cancel/`,
	);
	return res.data;
}

// --- MentorReview (Phase 11-D P11-21) ---

export interface MentorReview {
	id: number;
	contract: number;
	mentor: MentorMiniUser;
	mentee: MentorMiniUser | null;
	rating: number;
	comment: string;
	is_visible: boolean;
	created_at: string;
	updated_at: string;
}

export async function submitContractReview(
	contractId: number,
	rating: number,
	comment: string,
	client: AxiosInstance = api,
): Promise<MentorReview> {
	const res = await client.post<MentorReview>(
		`/mentor/contracts/${contractId}/review/`,
		{ rating, comment },
	);
	return res.data;
}

export async function listMentorReviews(
	handle: string,
	client: AxiosInstance = api,
): Promise<MentorReview[]> {
	const res = await client.get<MentorReview[]>(`/mentors/${handle}/reviews/`);
	return res.data;
}
