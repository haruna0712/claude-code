import { useGetUserProfileQuery } from "@/lib/redux/features/users/usersApiSlice";
import { useAppSelector } from "@/lib/redux/hooks/typedHooks";

export function useUserProfile() {
	const { isAuthenticated } = useAppSelector((state) => state.auth);

	const { data, isLoading, isError } = useGetUserProfileQuery(undefined, {
		skip: !isAuthenticated,
	});

	// /api/v1/users/me/ は CustomUser を直接返す (旧 `{profile: ...}` ラップなし)。
	return { profile: data, isLoading, isError };
}
