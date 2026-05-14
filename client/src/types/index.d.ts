/** lucide-react から render する icon 識別子。LeftNavbar / MobileNavbar 内で
 *  実際のコンポーネントへマッピングする (#297). */
export type LeftNavIconName =
	| "Home"
	| "Compass"
	| "Search"
	| "MessageSquare"
	| "User"
	| "UserSearch"
	| "Bell"
	| "MessagesSquare"
	| "FileText"
	| "Handshake"
	| "Sparkles";

export interface LeftNavLink {
	/** 静的 path。`isProfile=true` の時は無視され self handle を組み立てる。 */
	path: string;
	label: string;
	/** 旧 SVG 資産の path (Phase 1 から残存)。新 link は iconName を使う。 */
	imgLocation?: string;
	/** lucide-react icon 名。imgLocation と排他、両方無ければ label のみ render。 */
	iconName?: LeftNavIconName;
	/** 認証必須なら true。`useAuthNavigation` の filter で未認証時に隠す。 */
	requiresAuth?: boolean;
	/** プロフィール link 専用フラグ。LeftNavbar 側で path を `/u/<self.handle>`
	 *  に動的に組み立てる。self handle 未取得時は disabled or 非表示にする。 */
	isProfile?: boolean;
}

export interface UserCommonData {
	email: string;
	password: string;
}

export interface User {
	first_name: string;
	last_name: string;
	email: string;
}

export interface UserResponse {
	/** UUID 公開 ID (URL や外部参照に使う). */
	id: string;
	/**
	 * Bigint primary key (DM serializer の user_id / sender_id / creator_id と一致).
	 * Phase 3 で /auth/users/me/ に追加された (apps/users/serializers CustomUserSerializer)。
	 */
	pkid: number;
	email: string;
	first_name: string;
	last_name: string;
	username: string;
	slug: string;
	full_name: string;
	gender: string;
	occupation: string;
	phone_number: string;
	country: string;
	city: string;
	reputation: string;
	avatar: string;
	date_joined: string;
}
export interface RegisterUserData extends UserCommonData {
	username: string;
	first_name: string;
	last_name: string;
	re_password: string;
}

export interface LoginUserData extends UserCommonData {}

export interface ActivateUserData {
	uid: string;
	token: string;
}
export interface ResetPasswordConfirmData extends ActivateUserData {
	new_password: string;
	re_new_password: string;
}
export interface ResetPasswordData {
	email: string;
}

export interface RegisterUserResponse {
	id: string;
	username: string;
	first_name: string;
	last_name: string;
	email: string;
}
export interface LoginResponse {
	message: string;
}
export interface SocialAuthArgs {
	provider: string;
	state: string;
	code: string;
}
export interface SocialAuthResponse {
	message: string;
	user: User;
}

export interface QueryParams {
	page?: number;
	searchTerm?: string;
}

export interface ProfileData {
	gender?: string;
	occupation?: string;
	phone_number?: string;
	country?: string;
	city?: string;
	avatar?: string | File;
}

export interface Profile extends UserResponse {
	is_tenant?: boolean;
}

export interface ProfileResponse {
	profile: Profile;
}

export interface PaginatedResponse<T> {
	count: number;
	next: string | null;
	previous: string | null;
	results: T[];
}

export type ProfilesResponse = PaginatedResponse<Profile>;
export type NonTenantResponse = PaginatedResponse<Profile>;
