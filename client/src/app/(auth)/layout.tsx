/**
 * A direction auth shell layout (#556 Phase B-0-5).
 *
 * `/login` / `/register` / `/forgot-password` / `/password-reset/...` を
 * `(template)` (旧 dark LeftNavbar / RightSidebar 込み) から分離し、A direction の
 * light theme + devstream brand な auth-only shell に置く。AAuthFrame が
 * BrandMark / centered card / footer を担当する。
 *
 * Note: ルートグループは URL に含まれないため、`/login` は本グループから
 * 解決される。`(template)/(auth)/login/page.tsx` は本 PR で同時に削除し
 * 衝突を回避する。
 */

import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
