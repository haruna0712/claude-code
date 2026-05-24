/**
 * /search/users — 汎用ユーザー検索 page (Phase 12 P12-04 / P12-05)。
 *
 * spec: docs/specs/phase-12-residence-map-spec.md / phase-12 milestone #15
 *
 * - anon 閲覧可。 SSR で結果を取得。
 * - GET /api/v1/users/search/?q=&near_me=1&radius_km=N の cursor pagination を消費。
 * - P12-05: ?near_me=1 toggle + radius slider で「自分の近所」 にフィルタ。
 *   未ログイン or residence 未設定なら page 上で説明 + CTA。
 */

import type { Metadata } from "next";
import Link from "next/link";

import NearMeFilter from "@/components/search/NearMeFilter";
import OccupationFilter from "@/components/search/OccupationFilter";
import SearchModeTabs from "@/components/search/SearchModeTabs";
import SearchViewToggle from "@/components/search/SearchViewToggle";
import UserMapView from "@/components/search/UserMapView";
import UserSearchBox from "@/components/search/UserSearchBox";
import UserSearchResultCard from "@/components/search/UserSearchResultCard";
import WhoToFollow from "@/components/sidebar/WhoToFollow";
import type { Occupation } from "@/lib/api/occupation";
import { ApiServerError, serverFetch } from "@/lib/api/server";
import {
	buildUserSearchHref,
	buildUserSearchParams,
	PROXIMITY_RADIUS_DEFAULT_KM,
	PROXIMITY_RADIUS_MAX_KM,
	PROXIMITY_RADIUS_MIN_KM,
	type SearchView,
	type UserSearchPage as UserSearchPageData,
} from "@/lib/api/userSearch";
import type { CurrentUser } from "@/lib/api/users";

interface SearchPageProps {
	searchParams: {
		q?: string;
		cursor?: string;
		near_me?: string;
		radius_km?: string;
		/** Next.js は重複 query key を string[] に、 単一を string にする。 */
		occupation?: string | string[];
		/** P12-08: list (default) / map。 */
		view?: string;
	};
}

export const metadata: Metadata = {
	title: "ユーザー検索 — エンジニア SNS",
	description: "ユーザー名 / 表示名 / 自己紹介 / 居住地で検索する。",
};

interface SearchQuery {
	q: string;
	cursor?: string;
	nearMe: boolean;
	radiusKm: number;
	/** P12-07: URL ``?occupation=`` で復元した職業 slug (重複排除済)。 */
	occupations: string[];
	/** P12-08: list (default) / map の表示モード。 */
	view: SearchView;
}

/** ``occupation`` query を string[] に正規化 (単一 string / 配列 / 未指定)。
 *  空文字を落とし、 重複は除く (URL 安定 + filter の意味は集合)。 */
function parseOccupations(raw: string | string[] | undefined): string[] {
	const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
	const seen = new Set<string>();
	for (const slug of list) {
		const trimmed = slug.trim();
		if (trimmed) seen.add(trimmed);
	}
	return Array.from(seen);
}

function parseSearchParams(sp: SearchPageProps["searchParams"]): SearchQuery {
	const q = (sp.q ?? "").trim();
	const nearMe = sp.near_me === "1";
	const radiusParsed = Number(sp.radius_km);
	const radiusKm =
		Number.isFinite(radiusParsed) && radiusParsed > 0
			? Math.min(
					Math.max(radiusParsed, PROXIMITY_RADIUS_MIN_KM),
					PROXIMITY_RADIUS_MAX_KM,
				)
			: PROXIMITY_RADIUS_DEFAULT_KM;
	return {
		q,
		cursor: sp.cursor,
		nearMe,
		radiusKm,
		occupations: parseOccupations(sp.occupation),
		view: sp.view === "map" ? "map" : "list",
	};
}

/** SSR で職業 catalog を取得。 失敗しても検索自体は動かすため fail-safe で
 *  空配列に倒す (filter UI だけ消える)。 silent にしないよう console.error は残す。 */
async function loadOccupations(): Promise<Occupation[]> {
	try {
		return await serverFetch<Occupation[]>("/occupations/");
	} catch (error) {
		console.error("[search/users] failed to load occupations catalog", error);
		return [];
	}
}

async function loadCurrentUser(): Promise<CurrentUser | null> {
	try {
		return await serverFetch<CurrentUser>("/users/me/");
	} catch (error) {
		if (error instanceof ApiServerError) return null;
		return null;
	}
}

type SearchOutcome =
	| { kind: "results"; page: UserSearchPageData }
	| { kind: "missing_residence" }
	| { kind: "needs_login" }
	| { kind: "error"; message: string };

async function loadUserSearch(query: SearchQuery): Promise<SearchOutcome> {
	const qs = buildUserSearchParams({
		q: query.q,
		cursor: query.cursor,
		nearMe: query.nearMe,
		radiusKm: query.radiusKm,
		occupations: query.occupations,
	}).toString();
	const url = qs ? `/users/search/?${qs}` : "/users/search/";
	try {
		const page = await serverFetch<UserSearchPageData>(url);
		return { kind: "results", page };
	} catch (error) {
		if (error instanceof ApiServerError) {
			// near_me で residence 未設定 → backend 400 + {near_me: "..."}
			if (error.status === 400 && query.nearMe) {
				return { kind: "missing_residence" };
			}
			// 401 = anon ユーザーが near_me=1 を踏んだ
			if (error.status === 401) {
				return { kind: "needs_login" };
			}
			// 403 = auth 済みだが permission denied (将来 admin only 機能等)。
			// 「ログインが必要」 では誤誘導なので、 generic error として出す。
			// typescript-reviewer HIGH (#681) 指摘: 401/403 conflation を解消。
			return { kind: "error", message: `エラー (${error.status})` };
		}
		return { kind: "error", message: "検索 API に接続できませんでした" };
	}
}

/** cursor URL から `cursor=...` だけ抽出して相対 path にする。 */
function extractCursor(absoluteUrl: string | null): string | null {
	if (!absoluteUrl) return null;
	try {
		const u = new URL(absoluteUrl);
		return u.searchParams.get("cursor");
	} catch {
		// URL constructor が失敗するケース (ベース URL 無しの相対 URL 等) は素朴に search を切り出す
		const m = /[?&]cursor=([^&]+)/.exec(absoluteUrl);
		return m ? decodeURIComponent(m[1]) : null;
	}
}

function buildSearchHref(
	query: SearchQuery,
	overrides: { cursor?: string | null } = {},
): string {
	return buildUserSearchHref({
		q: query.q,
		nearMe: query.nearMe,
		radiusKm: query.radiusKm,
		occupations: query.occupations,
		view: query.view,
		cursor: overrides.cursor,
	});
}

export default async function UserSearchPage({
	searchParams,
}: SearchPageProps) {
	const query = parseSearchParams(searchParams);
	const [currentUser, occupationCatalog] = await Promise.all([
		loadCurrentUser(),
		loadOccupations(),
	]);
	const loggedIn = currentUser !== null;
	// 何も指定がなければ検索しない (occupation 選択も検索成立条件)
	const hasAnyQuery =
		query.q.length > 0 || query.nearMe || query.occupations.length > 0;
	const outcome = hasAnyQuery
		? await loadUserSearch(query)
		: ({
				kind: "results",
				page: { results: [], next: null, previous: null },
			} as SearchOutcome);

	const nextCursor =
		outcome.kind === "results" ? extractCursor(outcome.page.next) : null;
	const prevCursor =
		outcome.kind === "results" ? extractCursor(outcome.page.previous) : null;

	// header subtitle / 表示用: 選択 occupation slug を display_name に解決。
	// catalog に無い slug (取得失敗時など) は slug をそのまま見せる。
	// 表示有無は hasAnyQuery と一致する (occupationLabels.length === query.occupations.length)
	// ので別 flag を作らず hasAnyQuery を再利用する (typescript-reviewer 指摘の二重管理回避)。
	const occupationLabels = query.occupations.map(
		(slug) =>
			occupationCatalog.find((o) => o.slug === slug)?.display_name ?? slug,
	);

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
						検索
					</h1>
					{hasAnyQuery && (
						<p
							className="truncate text-[color:var(--a-text-subtle)]"
							style={{ fontFamily: "var(--a-font-mono)", fontSize: 11 }}
						>
							{query.q && `「${query.q}」`}
							{query.nearMe && ` · 半径 ${query.radiusKm}km`}
							{occupationLabels.length > 0 &&
								` · ${occupationLabels.join(" / ")}`}
						</p>
					)}
				</div>
			</header>

			<div className="p-5">
				<SearchModeTabs mode="users" query={query.q} />
				<p className="mb-3 text-xs text-[color:var(--a-text-muted)]">
					ユーザー名、表示名、自己紹介で検索します。投稿を探す場合は「投稿」タブに切り替えてください。
				</p>
				<div className="mb-3">
					<UserSearchBox initialValue={query.q} view={query.view} />
				</div>
				{/* mb-3 で filter 群の rhythm を揃える (ui-ux-tester MEDIUM:
				    near→chips が 68px で浮いていた)。 */}
				<div className="mb-3">
					{/* key で URL 状態が変わるたびに NearMeFilter を remount し、
					    `useState(initialXxx)` の初回 seed を最新値に強制する
					    (typescript-reviewer HIGH 修正、 client component が
					    Server Component の re-render で remount されない問題)。 */}
					<NearMeFilter
						key={`${query.nearMe}-${query.radiusKm}-${query.occupations.join(",")}`}
						query={query.q}
						initialNearMe={query.nearMe}
						initialRadiusKm={query.radiusKm}
						loggedIn={loggedIn}
						occupations={query.occupations}
						view={query.view}
					/>
				</div>

				{/* P12-07: 職業 chip filter。 catalog は SSR で取得 (失敗時は
				    OccupationFilter が null を返して filter UI が消える)。
				    selected は props から直接導出するので remount 用 key は不要。 */}
				<div className="mb-4">
					<OccupationFilter
						occupations={occupationCatalog}
						selected={query.occupations}
						query={query.q}
						nearMe={query.nearMe}
						radiusKm={query.radiusKm}
						view={query.view}
					/>
				</div>

				{/* P12-08: 一覧 ↔ 地図 の表示切替。 URL ?view= 同期、 filter は維持。 */}
				<div className="mb-6">
					<SearchViewToggle
						view={query.view}
						query={{
							q: query.q,
							nearMe: query.nearMe,
							radiusKm: query.radiusKm,
							occupations: query.occupations,
						}}
					/>
				</div>

				{/* P12-08: 地図 view。 現在の検索結果 (residence あり) を Circle 描画。 */}
				{query.view === "map" && outcome.kind === "results" && (
					<UserMapView
						results={outcome.page.results}
						hasQuery={hasAnyQuery}
						hasMore={outcome.page.next != null}
						listHref={buildUserSearchHref({
							q: query.q,
							nearMe: query.nearMe,
							radiusKm: query.radiusKm,
							occupations: query.occupations,
							view: "list",
						})}
					/>
				)}

				{!hasAnyQuery && query.view === "list" && (
					<>
						<p className="mb-6 text-sm text-[color:var(--a-text-muted)]">
							ユーザー名 / 表示名 / 自己紹介 (bio) で部分一致検索できます。
							ログイン中は「近所で絞り込む」 で居住地の近い人だけに絞れます。
						</p>
						{/* #810: ハルナさん指示 — ユーザータブ + q なし のとき
						    「おすすめユーザー」 を中央に表示 (投稿タブの 「最新の投稿」 と
						    同じ pattern)。 WhoToFollow は anon でも popular fallback で
						    動くので auth 分岐なしでそのまま使える。
						    #810 hotfix: bare={true} で WhoToFollow 内蔵の h2
						    「おすすめユーザー」 を抑制し、 外側の h2 と重複させない。 */}
						<section
							aria-labelledby="users-recommended-heading"
							className="space-y-3"
						>
							<h2
								id="users-recommended-heading"
								className="mb-4 px-2 text-lg font-semibold text-foreground"
							>
								おすすめユーザー
							</h2>
							<WhoToFollow isAuthenticated={loggedIn} bare />
						</section>
					</>
				)}

				{outcome.kind === "missing_residence" && (
					<p
						role="status"
						className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-6 text-sm text-[color:var(--a-text-muted)]"
					>
						居住地が未設定なので近所検索できません。{" "}
						<Link
							href="/settings/residence"
							className="text-[color:var(--a-accent)] hover:underline"
						>
							/settings/residence で地図を設定する
						</Link>
					</p>
				)}

				{outcome.kind === "needs_login" && (
					<p
						role="status"
						className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-6 text-sm text-[color:var(--a-text-muted)]"
					>
						近所検索にはログインが必要です。{" "}
						<Link
							href={`/login?next=${encodeURIComponent(buildSearchHref(query))}`}
							className="text-[color:var(--a-accent)] hover:underline"
						>
							ログイン
						</Link>
					</p>
				)}

				{outcome.kind === "error" && (
					<p
						role="alert"
						className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-6 text-sm text-[color:var(--a-text-muted)]"
					>
						検索に失敗しました: {outcome.message}
					</p>
				)}

				{query.view === "list" &&
					outcome.kind === "results" &&
					hasAnyQuery &&
					outcome.page.results.length === 0 && (
						<p
							role="status"
							className="rounded-lg border border-dashed border-[color:var(--a-border)] px-4 py-10 text-center text-sm text-[color:var(--a-text-muted)]"
						>
							条件に一致するユーザーは見つかりませんでした。
						</p>
					)}

				{query.view === "list" &&
					outcome.kind === "results" &&
					outcome.page.results.length > 0 && (
						<section aria-label="検索結果">
							<p
								role="status"
								className="mb-3 text-xs text-[color:var(--a-text-muted)]"
							>
								{outcome.page.results.length} 件
								{outcome.page.next ? " (続きあり)" : ""}
							</p>
							<ul role="list" className="space-y-2">
								{outcome.page.results.map((u) => (
									<UserSearchResultCard key={u.user_id} user={u} />
								))}
							</ul>

							<nav
								aria-label="ページ送り"
								className="mt-6 flex items-center justify-between text-sm"
							>
								{prevCursor ? (
									<Link
										href={buildSearchHref(query, { cursor: prevCursor })}
										className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
									>
										← 前の 20 件
									</Link>
								) : (
									<span aria-hidden="true" />
								)}
								{nextCursor ? (
									<Link
										href={buildSearchHref(query, { cursor: nextCursor })}
										className="rounded-md border border-border px-3 py-1.5 hover:bg-muted/40"
									>
										次の 20 件 →
									</Link>
								) : (
									<span aria-hidden="true" />
								)}
							</nav>
						</section>
					)}
			</div>
		</>
	);
}
