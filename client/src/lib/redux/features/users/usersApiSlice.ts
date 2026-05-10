import { baseApiSlice } from "@/lib/redux/features/api/baseApiSlice";
import { components } from "@/types/api.generated";
import {
	NonTenantResponse,
	ProfileData,
	ProfilesResponse,
	QueryParams,
} from "@/types";

// /api/v1/users/me/ の正式レスポンス型 (drf-spectacular generated)。
// 旧 ProfileResponse `{profile: {...}}` 形式 (legacy cookiecutter) は実 backend に
// 存在しないエンドポイントを叩いていたため、本 PR で /users/me/ に統一する (#269 後続)。
export type CurrentUserResponse = components["schemas"]["CustomUser"];

export const usersApiSlice = baseApiSlice.injectEndpoints({
	endpoints: (builder) => ({
		getAllUsers: builder.query<ProfilesResponse, QueryParams>({
			query: (params = {}) => {
				const queryString = new URLSearchParams();

				if (params.page) {
					queryString.append("page", params.page.toString());
				}
				if (params.searchTerm) {
					queryString.append("search", params.searchTerm);
				}
				return `/profiles/all/?${queryString.toString()}`;
			},
			providesTags: ["User"],
		}),

		getAllTechnicians: builder.query<NonTenantResponse, QueryParams>({
			query: (params = {}) => {
				const queryString = new URLSearchParams();

				if (params.page) {
					queryString.append("page", params.page.toString());
				}
				if (params.searchTerm) {
					queryString.append("search", params.searchTerm);
				}
				return `/profiles/non-tenant-profiles/?${queryString.toString()}`;
			},
			providesTags: ["User"],
		}),
		// 旧 endpoint `/profiles/user/my-profile/` (cookiecutter 由来) は backend に
		// 存在せず 404。実 endpoint は /api/v1/users/me/ で CustomUser を直接返す。
		getUserProfile: builder.query<CurrentUserResponse, void>({
			query: () => "/users/me/",
			providesTags: ["User"],
		}),
		// Issue #480: handle 前方一致検索 (autocomplete 用、最大 50 件)。
		searchUsers: builder.query<
			{
				results: {
					user_id: string;
					username: string;
					first_name: string;
					last_name: string;
					avatar_url: string | null;
				}[];
			},
			{ q: string; limit?: number }
		>({
			query: ({ q, limit = 10 }) => {
				const params = new URLSearchParams();
				params.set("q", q);
				params.set("limit", String(limit));
				return `/users/?${params.toString()}`;
			},
		}),
		updateUserProfile: builder.mutation<ProfileData, ProfileData>({
			query: (formData) => ({
				url: "/profiles/user/update/",
				method: "PATCH",
				body: formData,
			}),
			invalidatesTags: ["User"],
		}),
	}),
});

export const {
	useGetAllUsersQuery,
	useGetUserProfileQuery,
	useUpdateUserProfileMutation,
	useGetAllTechniciansQuery,
	useSearchUsersQuery,
} = usersApiSlice;
