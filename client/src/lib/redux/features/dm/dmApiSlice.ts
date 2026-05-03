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
	DMMessage,
	DMRoom,
	DMRoomListResponse,
	GroupInvitation,
	InvitationListResponse,
	RoomMessagesResponse,
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
		// P3-09: 履歴取得 (新しい順で limit 件、画面側で reverse して下から表示)
		listRoomMessages: builder.query<
			RoomMessagesResponse,
			{ roomId: number; limit?: number }
		>({
			query: ({ roomId, limit = 30 }) =>
				`/dm/rooms/${roomId}/messages/?limit=${limit}`,
			transformResponse: (raw: RoomMessagesResponse | DMMessage[]) => {
				// DRF が pagination 無しで配列を返すケースに備えて normalize する。
				if (Array.isArray(raw)) {
					return { results: raw } as RoomMessagesResponse;
				}
				return raw;
			},
		}),
		// P3-05: 既読更新 REST (initial load 時に呼ぶ)。WebSocket でも更新可。
		markRoomRead: builder.mutation<{ ok: true }, number>({
			query: (roomId) => ({
				url: `/dm/rooms/${roomId}/read/`,
				method: "POST",
			}),
			invalidatesTags: (_result, _error, roomId) => [
				{ type: "DMRoom" as const, id: roomId },
				{ type: "DMRoom" as const, id: "LIST" },
			],
		}),
		// #274: 自分の DM message を soft-delete する。SPEC §7.3。
		// backend (apps/dm/views.py MessageDestroyView) は WebSocket 経由で
		// `message.deleted` イベントを broadcast するため、UI 側はサーバ応答を
		// 待たず楽観的に消す or broadcast を待つ。RoomChat は WS 経由で
		// `setMessages(prev => prev.filter(m => m.id !== id))` する想定 (P3-09)。
		deleteMessage: builder.mutation<void, number>({
			query: (id) => ({
				url: `/dm/messages/${id}/`,
				method: "DELETE",
			}),
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
	useListRoomMessagesQuery,
	useMarkRoomReadMutation,
	useDeleteMessageMutation,
} = dmApiSlice;
