/**
 * DM RTK Query slice (P3-08〜P3-12 / Issue #233-237).
 *
 * Phase 3 の REST 経路をすべて網羅する。WebSocket は別 hook
 * (`useDMSocket`, P3-16/#241) で扱う。
 *
 * 設計:
 * - tag types `DMRoom` / `DMInvitation` で cache invalidation を明示。
 *   `injectEndpoints` で baseApiSlice の `tagTypes` を拡張するため、
 *   baseApiSlice 側の `tagTypes` 配列にも `"DMRoom" | "DMInvitation"` を追加する。
 * - `transformResponse` は使わず Django serializer 形式をそのまま流す
 *   (型定義側で吸収)。
 */

import { baseApiSlice } from "@/lib/redux/features/api/baseApiSlice";

import type {
	CreateRoomInput,
	DMRoom,
	DMRoomListResponse,
	GroupInvitation,
	InvitationListResponse,
} from "./types";

export const dmApiSlice = baseApiSlice.injectEndpoints({
	endpoints: (builder) => ({
		listDMRooms: builder.query<DMRoomListResponse, void>({
			query: () => "/dm/rooms/",
			providesTags: (result) =>
				result
					? [
							...result.results.map((room) => ({
								type: "DMRoom" as const,
								id: room.id,
							})),
							{ type: "DMRoom" as const, id: "LIST" },
						]
					: [{ type: "DMRoom" as const, id: "LIST" }],
		}),
		getDMRoom: builder.query<DMRoom, number>({
			query: (id) => `/dm/rooms/${id}/`,
			providesTags: (_result, _error, id) => [{ type: "DMRoom" as const, id }],
		}),
		createDMRoom: builder.mutation<DMRoom, CreateRoomInput>({
			query: (body) => ({
				url: "/dm/rooms/",
				method: "POST",
				body,
			}),
			invalidatesTags: [{ type: "DMRoom" as const, id: "LIST" }],
		}),
		listInvitations: builder.query<
			InvitationListResponse,
			{ status?: "pending" | "all" } | void
		>({
			query: (arg) => {
				const params = new URLSearchParams();
				if (arg && arg.status) {
					params.append("status", arg.status);
				} else {
					params.append("status", "pending");
				}
				return `/dm/invitations/?${params.toString()}`;
			},
			providesTags: (result) =>
				result
					? [
							...result.results.map((inv) => ({
								type: "DMInvitation" as const,
								id: inv.id,
							})),
							{ type: "DMInvitation" as const, id: "LIST" },
						]
					: [{ type: "DMInvitation" as const, id: "LIST" }],
		}),
		acceptInvitation: builder.mutation<GroupInvitation, number>({
			query: (id) => ({
				url: `/dm/invitations/${id}/accept/`,
				method: "POST",
			}),
			invalidatesTags: (_result, _error, id) => [
				{ type: "DMInvitation" as const, id },
				{ type: "DMInvitation" as const, id: "LIST" },
				{ type: "DMRoom" as const, id: "LIST" },
			],
		}),
		declineInvitation: builder.mutation<GroupInvitation, number>({
			query: (id) => ({
				url: `/dm/invitations/${id}/decline/`,
				method: "POST",
			}),
			invalidatesTags: (_result, _error, id) => [
				{ type: "DMInvitation" as const, id },
				{ type: "DMInvitation" as const, id: "LIST" },
			],
		}),
	}),
	overrideExisting: false,
});

export const {
	useListDMRoomsQuery,
	useGetDMRoomQuery,
	useCreateDMRoomMutation,
	useListInvitationsQuery,
	useAcceptInvitationMutation,
	useDeclineInvitationMutation,
} = dmApiSlice;
