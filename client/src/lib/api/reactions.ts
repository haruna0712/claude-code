/**
 * Reactions API helpers (P2-14 / Issue #187).
 *
 * Backend (P2-04 #179) exposes:
 *   POST   /api/v1/tweets/<id>/reactions/  body={kind} → toggle
 *   GET    /api/v1/tweets/<id>/reactions/             → counts + my_kind
 *
 * Toggle semantics (X-style, 1 user 1 tweet 1 kind):
 *   - same kind     → reaction removed
 *   - different kind → reaction changed (old kind decremented, new kind incremented)
 *   - no existing   → reaction created
 */

import type { AxiosInstance } from "axios";
import { api, ensureCsrfToken } from "@/lib/api/client";

export const REACTION_KINDS = [
	"like",
	"interesting",
	"learned",
	"helpful",
	"agree",
	"surprised",
	"congrats",
	"respect",
	"funny",
	"code",
] as const;

export type ReactionKind = (typeof REACTION_KINDS)[number];

export interface ReactionMeta {
	emoji: string;
	label: string;
}

export const REACTION_META: Record<ReactionKind, ReactionMeta> = {
	like: { emoji: "❤️", label: "いいね" },
	interesting: { emoji: "💡", label: "面白い" },
	learned: { emoji: "📚", label: "勉強になった" },
	helpful: { emoji: "🙏", label: "助かった" },
	agree: { emoji: "👍", label: "わかる" },
	surprised: { emoji: "😲", label: "びっくり" },
	congrats: { emoji: "🎉", label: "おめでとう" },
	respect: { emoji: "🫡", label: "リスペクト" },
	funny: { emoji: "😂", label: "笑った" },
	code: { emoji: "💻", label: "コードよき" },
};

export interface ReactionAggregate {
	counts: Partial<Record<ReactionKind, number>>;
	my_kind: ReactionKind | null;
}

export interface ToggleReactionResult {
	kind: ReactionKind | null;
	created: boolean;
	changed: boolean;
	removed: boolean;
}

export async function fetchReactions(
	tweetId: number | string,
	client: AxiosInstance = api,
): Promise<ReactionAggregate> {
	const res = await client.get<ReactionAggregate>(
		`/tweets/${tweetId}/reactions/`,
	);
	return res.data;
}

export async function toggleReaction(
	tweetId: number | string,
	kind: ReactionKind,
	client: AxiosInstance = api,
): Promise<ToggleReactionResult> {
	await ensureCsrfToken(client);
	const res = await client.post<ToggleReactionResult>(
		`/tweets/${tweetId}/reactions/`,
		{ kind },
	);
	return res.data;
}
