/**
 * Follow API slice (#296).
 *
 * Backend:
 *   - POST   /api/v1/users/<handle>/follow/   → 201 (新規) / 200 (既存) / 400 / 403
 *   - DELETE /api/v1/users/<handle>/follow/   → 204 / 404
 *
 * RTK Query mutation。`PublicProfile` の `is_following` を invalidate して
 * /u/<handle> の Follow button 表示を最新化する。
 */
import { baseApiSlice } from "@/lib/redux/features/api/baseApiSlice";

/**
 * #735: follow POST の response shape (FollowResponseSerializer)。
 * 公開アカへの follow は status="approved"、 鍵アカへの follow は
 * status="pending" を返す。
 */
export interface FollowMutationResponse {
	follower?: string;
	followee?: string;
	created?: boolean;
	status: "approved" | "pending";
}

export const followsApiSlice = baseApiSlice.injectEndpoints({
	endpoints: (builder) => ({
		followUser: builder.mutation<FollowMutationResponse, string>({
			query: (handle) => ({
				url: `/users/${handle}/follow/`,
				method: "POST",
			}),
			// PublicProfile に紐づく cache を一括 invalidate (target handle の
			// is_following を refetch する)。
			invalidatesTags: (_res, _err, handle) => [{ type: "User", id: handle }],
		}),
		unfollowUser: builder.mutation<void, string>({
			query: (handle) => ({
				url: `/users/${handle}/follow/`,
				method: "DELETE",
			}),
			invalidatesTags: (_res, _err, handle) => [{ type: "User", id: handle }],
		}),
	}),
});

export const { useFollowUserMutation, useUnfollowUserMutation } =
	followsApiSlice;
