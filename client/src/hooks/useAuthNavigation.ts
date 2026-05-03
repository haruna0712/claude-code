import { leftNavLinks } from "@/constants";
import { useLogoutUserMutation } from "@/lib/redux/features/auth/authApiSlice";
import { setLogout } from "@/lib/redux/features/auth/authSlice";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hooks/typedHooks";
import { extractErrorMessage } from "@/utils";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";

export function useAuthNavigation() {
	const dispatch = useAppDispatch();
	const [logoutUser] = useLogoutUserMutation();
	const { isAuthenticated } = useAppSelector((state) => state.auth);
	const router = useRouter();

	const handleLogout = async () => {
		try {
			await logoutUser().unwrap();
			dispatch(setLogout());
			router.push("/login");
			toast.success("Logged Out!");
		} catch (e) {
			const errorMessage = extractErrorMessage(e);
			toast.error(errorMessage || "An error occurred");
		}
	};

	// #297: 旧 hard-code path 列挙ではなく、各 link の `requiresAuth` flag で
	// 判定する。新規 link 追加時に hook を触らずに constants だけで完結する。
	const filteredNavLinks = leftNavLinks.filter((link) => {
		if (link.requiresAuth) return isAuthenticated;
		return true;
	});

	return { handleLogout, filteredNavLinks, isAuthenticated };
}
