import { useAppSelector } from "@/lib/redux/hooks/typedHooks";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const useRedirectIfAuthenticated = () => {
	const router = useRouter();
	const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

	useEffect(() => {
		if (isAuthenticated) {
			// 認証済みで login/register 画面に来た場合はホーム TL へ。
			// 初回 onboarding 誘導は LoginForm 側で /onboarding を push するので、
			// この hook はあくまで「ログイン状態の人を auth 画面から逃がす」用途。
			router.push("/");
		}
	}, [isAuthenticated, router]);
};

export default useRedirectIfAuthenticated;
