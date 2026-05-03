import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import { setAuth, setLogout } from "@/lib/redux/features/auth/authSlice";
import {
	BaseQueryFn,
	FetchArgs,
	FetchBaseQueryError,
} from "@reduxjs/toolkit/query";

import { Mutex } from "async-mutex";

const mutex = new Mutex();

const CSRF_COOKIE_NAME = "csrftoken";
const CSRF_HEADER_NAME = "X-CSRFToken";

/**
 * `csrftoken` cookie 値を `document.cookie` から抽出。SSR では `document` 未定義
 * のため null を返す (RTK Query の prepareHeaders は viewer 側でだけ実行される
 * 想定だが安全のためガード)。
 */
function readCsrfTokenFromCookie(): string | null {
	if (typeof document === "undefined") return null;
	const match = document.cookie.match(
		new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]+)`),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

const baseQuery = fetchBaseQuery({
	baseUrl: "/api/v1",
	credentials: "include",
	// #285 fix: state-changing requests (POST / PUT / PATCH / DELETE) には
	// CSRF Double-Submit cookie のため X-CSRFToken header を注入する必要がある。
	// 既存の axios client (lib/api/client.ts) と同じ仕組みを RTK Query にも適用。
	// 未注入だと Django 側 CSRFEnforcingAuthentication が 403 を返す。
	prepareHeaders: (headers, { type }) => {
		// type は "query" | "mutation"。mutation は概ね unsafe method なので
		// 全て CSRF token を注入する。
		if (type === "mutation") {
			const csrfToken = readCsrfTokenFromCookie();
			if (csrfToken) {
				headers.set(CSRF_HEADER_NAME, csrfToken);
			}
		}
		return headers;
	},
});

/**
 * stg/prod では login レスポンスに csrftoken cookie が乗らない (cookie_create_view
 * は @ensure_csrf_cookie を持たない) ため、初回 mutation 時に document.cookie 上
 * に csrftoken が無いと X-CSRFToken header が空になり Django が 403 を返す。
 * 本 helper は mutation 直前に csrftoken cookie 不在を検知したら GET /auth/csrf/
 * (axios client と同じ endpoint) で 1 回 seed する。SSR では document が無いので
 * no-op。
 */
async function ensureCsrfCookie(): Promise<void> {
	if (typeof document === "undefined") return;
	if (readCsrfTokenFromCookie()) return;
	try {
		await fetch("/api/v1/auth/csrf/", { credentials: "include" });
	} catch {
		// network error は呼び出し側 mutation 自体が拾うので握りつぶす。
	}
}

const baseQueryWithReauth: BaseQueryFn<
	string | FetchArgs,
	unknown,
	FetchBaseQueryError
> = async (args, api, extraOptions) => {
	await mutex.waitForUnlock();

	// mutation の場合だけ csrftoken cookie の seed を保証する。
	// (api.type は createApi 内部で "query" | "mutation" として渡される)
	if ((api as { type?: string }).type === "mutation") {
		await ensureCsrfCookie();
	}

	let response = await baseQuery(args, api, extraOptions);

	if (response.error && response.error.status === 401) {
		if (!mutex.isLocked()) {
			const release = await mutex.acquire();
			try {
				const refreshResponse = await baseQuery(
					{
						url: "/auth/refresh/",
						method: "POST",
					},
					api,
					extraOptions,
				);

				if (refreshResponse?.data) {
					api.dispatch(setAuth());
					response = await baseQuery(args, api, extraOptions);
				} else {
					api.dispatch(setLogout());
				}
			} finally {
				release();
			}
		} else {
			await mutex.waitForUnlock();
			response = await baseQuery(args, api, extraOptions);
		}
	}
	return response;
};

export const baseApiSlice = createApi({
	reducerPath: "api",
	baseQuery: baseQueryWithReauth,
	tagTypes: [
		"User",
		"Apartment",
		"Issue",
		"Report",
		"Post",
		// P3-08〜P3-12: DM 系 (apps/dm)
		"DMRoom",
		"DMInvitation",
	],
	refetchOnFocus: true,
	refetchOnMountOrArgChange: true,
	endpoints: (builder) => ({}),
});
