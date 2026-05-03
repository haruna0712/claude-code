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

const baseQueryWithReauth: BaseQueryFn<
	string | FetchArgs,
	unknown,
	FetchBaseQueryError
> = async (args, api, extraOptions) => {
	await mutex.waitForUnlock();

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
