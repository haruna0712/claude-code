/**
 * Profile / onboarding API helpers (P1-14).
 *
 * Thin typed wrappers over ``/api/v1/users/…``. The full profile shape the
 * backend returns is larger than what the UI usually cares about; we only
 * surface the commonly-needed fields here. Callers that need more can cast or
 * call the axios client directly.
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";

export interface CurrentUser {
	id: string;
	email: string;
	username: string;
	full_name: string;
	display_name: string;
	bio: string;
	avatar_url: string;
	header_url: string;
	is_premium: boolean;
	needs_onboarding: boolean;
	github_url: string;
	x_url: string;
	zenn_url: string;
	qiita_url: string;
	note_url: string;
	linkedin_url: string;
	// P13-04: Phase 13 自動翻訳機能 (auto-translate)
	preferred_language: string;
	auto_translate: boolean;
	// #735: 鍵アカ機能。 true ならアカウント非公開。
	// spec: docs/specs/private-account-spec.md
	is_private: boolean;
	date_joined: string;
}

export interface CompleteOnboardingPayload {
	display_name: string;
	bio?: string;
}

export interface UpdateProfilePayload {
	display_name?: string;
	bio?: string;
	github_url?: string;
	x_url?: string;
	zenn_url?: string;
	qiita_url?: string;
	note_url?: string;
	linkedin_url?: string;
	// P13-04: 翻訳設定の更新
	preferred_language?: string;
	auto_translate?: boolean;
	// #735: 鍵アカ機能の toggle。
	is_private?: boolean;
}

export async function fetchCurrentUser(
	client: AxiosInstance = api,
): Promise<CurrentUser> {
	const res = await client.get<CurrentUser>("/users/me/");
	return res.data;
}

export async function completeOnboarding(
	payload: CompleteOnboardingPayload,
	client: AxiosInstance = api,
): Promise<CurrentUser> {
	await ensureCsrfToken(client);
	const res = await client.post<CurrentUser>(
		"/users/me/complete_onboarding/",
		payload,
	);
	return res.data;
}

export async function updateCurrentUser(
	payload: UpdateProfilePayload,
	client: AxiosInstance = api,
): Promise<CurrentUser> {
	await ensureCsrfToken(client);
	const res = await client.patch<CurrentUser>("/users/me/", payload);
	return res.data;
}
