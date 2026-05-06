# おすすめユーザー (Who to follow) 仕様書

> Version: 0.1
> 最終更新: 2026-05-05
> ステータス: 実装済 (Phase 2 P2-10 / #185 backend、P2-17 / #189 frontend、#370/#390 で bug fix)
> 関連: [SPEC.md §5](../SPEC.md), [ROADMAP.md Phase 2](../ROADMAP.md), [reactions-spec.md](./reactions-spec.md)

---

## 0. このドキュメントの位置づけ

エンジニア特化型 SNS の **おすすめユーザーサイドバー** (Who to follow) の挙動を、UI / API / DB / キャッシュの全レイヤで一貫させるための仕様書。`docs/SPEC.md §5.3` は要件 (3 段階の優先順) しか触れていないので、本書で API レスポンス形・キャッシュ TTL・Block 連動・viewer 別フィルタ・frontend transform などの細部を確定させる。

**ゴール**: ログインユーザにはパーソナライズされた候補を、未ログインユーザには「人気ユーザー」を、ともに同じ右サイドバー UI で出す。エンジニアコミュニティに新規参加したユーザでも有意な接点を提示する。

---

## 1. 用語

| 用語        | 定義                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------- |
| viewer      | リクエスト元のユーザ (= `request.user`)。匿名は `AnonymousUser`                                             |
| candidate   | 表示候補となる別ユーザ (= `User` レコード)。viewer 自身 / 既フォロー / Bot / Block 関係は除外               |
| reason      | 推奨理由 (`recent_reaction` / `popular` / `null`)。frontend で日本語ラベルに mapping                        |
| WhoToFollow | 右サイドバーの recommendation panel (component)。`client/src/components/sidebar/WhoToFollow.tsx`            |
| right rail  | デスクトップ (`lg+` 以上) で main column の右側に表示されるサイドバー。RightSidebar component が mount する |

---

## 2. バックエンド仕様

### 2.1 Service: `compute_who_to_follow(user, limit)`

`apps/follows/services.py` が正本。SPEC §5.3 の優先順:

#### Step 1: 興味関心タグ (deferred)

`UserInterestTag` モデルが Phase 4 以降で実装されたら有効化する。それまで no-op (skip)。

#### Step 2: リアクション履歴ベース

直近 30 日 (`RECENT_REACTION_DAYS=30`) で viewer が reaction を付けた tweet の **author** を、reaction 数の多い順で並べる。

```python
candidates = (
    Reaction.objects.filter(user=viewer, created_at__gte=cutoff)
    .values("tweet__author_id")
    .annotate(c=Count("id"))
    .order_by("-c")
)
```

各候補に `reason="recent_reaction"` を付与。

#### Step 3: フォロワー数 fallback (strict)

Step 2 で `limit` 未満なら、フォロワー数上位の User で埋める:

```python
qs = (
    User.objects.filter(is_active=True)
    .exclude(pk__in=exclude_ids)  # exclude_ids = self + blocked + following
    .order_by("-followers_count")
    [:limit]
)
```

各候補に `reason="popular"` を付与。

> 表示数 (limit) 自体は frontend が決める。WhoToFollow component は `LIMIT=3` (#399 で 5 → 3)。**既フォローは決して出さない方針** なので、候補が limit に足りなければ 1〜2 人、または 0 人で表示する。「フォロー中」のユーザを推奨に出す Step 4 (#399 で導入) は #410 で撤回した — UI 上「フォロー中」が並んでも操作の意味がないため、X / FB の動線に揃える。

### 2.2 除外条件

すべての Step で以下を除外する (`exclude_ids` または queryset filter で):

- viewer 自身 (`user.pk`)
- viewer が既フォローしているユーザ (`Follow.objects.filter(follower=user).values_list("followee_id")`)
- viewer と双方向 Block 関係のユーザ (`apps.moderation.Block`、Phase 4B 実装後に有効化)
- Bot ユーザ (現状 Bot 機能が無いため no-op、Phase 7 で対応)
- **`is_active=False` のユーザ (#394)**: `apps/users/views.py::PublicProfileView` が `is_active=True` だけを公開する方針なので、推奨にも同じ filter を掛けないと「click すると 404」 (壊れた link) になる。`_candidates_from_followers_count` で `User.objects.filter(is_active=True)` を掛け、`_serialize_users` でも二段防御として `pk__in + is_active=True` で再 filter する。`get_popular_users` も同様。

### 2.3 Service: `get_who_to_follow(user, limit)` キャッシュ

```
key: who_to_follow:{user_id}
TTL: 60 min (TTL_SECONDS = 60 * 60)
```

cache miss → `compute_who_to_follow` を呼ぶ → 結果を Redis に SET → 返す。

設計判断:

- TTL 60 min: 候補の鮮度よりサーバ負荷低減を優先。reaction 履歴は秒単位で変わるが、おすすめは「だいたい合っていれば良い」UX。
- viewer 別 key: 個人化が前提。共有 key にはしない。
- invalidation hook は **設けない** (= TTL 切れ待ち)。Phase 8 以降でフォロー / unfollow 後の即時反映が必要になったら手動 invalidate を追加。

### 2.4 Service: `get_popular_users(limit)`

未ログイン用 (anonymous viewer)。viewer 別フィルタを掛けず、フォロワー数上位を素直に返す。`reason=None` 固定。

```python
qs = User.objects.order_by("-followers_count")[:limit]
```

キャッシュ無し (= 全 anonymous で同じ結果なので、CDN / Cache-Control header で別途キャッシュする想定。MVP では毎回 DB hit)。

### 2.5 API レスポンス形

`apps/follows/services.py::_serialize_users` の出力:

```json
{
	"results": [
		{
			"user": {
				"id": "<uuid string>",
				"handle": "test3",
				"display_name": "haruna",
				"avatar_url": "https://stg.codeplace.me/users/.../avatar.webp",
				"bio": "...",
				"followers_count": 1
			},
			"reason": "recent_reaction"
		}
	]
}
```

**重要**: 各行は `{user: {...}, reason: ...}` で **wrap されている**。frontend は per-row `user` wrapper を flatten する責務を持つ (§3.2 参照)。

### 2.6 エンドポイント

| エンドポイント                   | view                   | permission      | 認証 | 動作                                      |
| -------------------------------- | ---------------------- | --------------- | ---- | ----------------------------------------- |
| `GET /api/v1/users/recommended/` | `RecommendedUsersView` | IsAuthenticated | 必須 | `get_who_to_follow(viewer, limit)` を返す |
| `GET /api/v1/users/popular/`     | `PopularUsersView`     | AllowAny        | 不要 | `get_popular_users(limit)` を返す         |

両方とも query string `?limit=N` (1〜50、default 10) を受ける。

**ルーティング注意 (#370)**: `urls_profile.py` の `<str:username>/` greedy match に飲まれて 404 を返していた既知のバグは PR #371 で修正済 (follows.urls を urls_profile より前に登録)。

### 2.7 Rate limit

DRF default の `AnonRateThrottle` / `UserRateThrottle` が適用される。専用 scope は持たない。サイドバー単体 fetch なので 1 page 1 req 程度、rate limit にぶつかる用途ではない。

---

## 3. フロントエンド仕様

### 3.1 Component: `WhoToFollow.tsx`

`client/src/components/sidebar/WhoToFollow.tsx` が正本。

- props: `isAuthenticated: boolean`
- 動作:
  - `isAuthenticated=true` → `/users/recommended/?limit=5` を fetch (API 失敗時は error state)
  - `isAuthenticated=false` → `/users/popular/?limit=5` を fetch (匿名 access OK)
- 描画状態 (loading / ready / error):
  - loading: 3 row のスケルトン (animate-pulse、avatar 円 + 2 line)
  - ready (`users.length > 0`): user 行を `flex flex-col gap-3` で list 化
  - ready (`users.length === 0`): "おすすめユーザーがいません" の placeholder
  - error: "おすすめの取得に失敗しました" の placeholder

#### 3.1.1 各 user 行のレイアウト (#392)

X (Twitter) の "Who to follow" panel に倣い、以下の構成で render する:

```
[avatar] [display_name (太字)]   [Follow button]
         [@handle (灰色)]
         [bio (灰色, 2 行 line-clamp)]
         [reason chip (auth + reason 有り の場合のみ)]
```

- **avatar** は `<Link href="/u/<handle>" aria-label="<name> のプロフィール">` で wrap (#392)
- **display_name + @handle + bio** ブロックも `<Link>` で wrap (1 つの link で十分。Tab fold 数を減らすため)
  - display_name が空文字のときは `@handle` を太字 fallback で表示
- **bio**: `tailwind line-clamp-2` で 2 行に truncate
- **reason chip**: 既存通り `localizeReason(user.reason)` 経由で日本語化、auth + 値ありのときのみ表示
- **FollowButton**: 認証時のみ。avatar / 名前 Link とは別の interactive element

詳しい遷移仕様は [profile-navigation-spec.md](./profile-navigation-spec.md) を参照。

### 3.2 API helper: `trending.ts::fetchRecommendedUsers` / `fetchPopularUsers`

`client/src/lib/api/trending.ts` が正本。

#### 重要 (#390): 2 段階 unwrap

backend response は **二重に wrap** されている:

1. top-level `{results: [...]}` envelope (DRF pagination 風)
2. per-row `{user: {...}, reason: ...}` wrapper

frontend は両方を flatten して flat な `SidebarUser` 配列を返す。

```ts
function flattenSidebarUser(row: any): SidebarUser {
	if (
		row &&
		typeof row === "object" &&
		row.user &&
		typeof row.user === "object"
	) {
		return { ...row.user, reason: row.reason ?? undefined };
	}
	return row; // 既に flat (テストの mock 等)
}
```

shape:

```ts
export interface SidebarUser {
	id?: string;
	handle: string;
	display_name: string;
	avatar_url?: string;
	bio?: string;
	followers_count?: number;
	is_following?: boolean;
	reason?: string;
}
```

### 3.3 Reason 日本語ラベル mapping

backend は `reason` を short string で返す (`recent_reaction` / `popular` / `null`)。frontend で日本語にマップして UI に出す:

| backend value        | UI 表示                       |
| -------------------- | ----------------------------- |
| `recent_reaction`    | `最近リアクションした投稿者`  |
| `popular`            | `フォロワーが多い`            |
| `null` / `undefined` | chip 非表示                   |
| 未知の値             | そのまま表示 (forward-compat) |

mapping は frontend `client/src/lib/api/trending.ts` の `REASON_LABELS` 定数で集中管理する。

### 3.4 配置

`client/src/app/(template)/layout.tsx` で `RightSidebar` を mount し、その中で `<WhoToFollow isAuthenticated={...} />` を render する。lg+ (1024px+) のみ表示、tablet 以下では非表示。

`isAuthenticated` の判定は `cookies().get("logged_in")?.value === "true"` (server-side cookie 読み取り、SSR 時に確定)。

---

## 4. a11y

- root: `<section aria-labelledby="sidebar-wtf-heading">`、heading は `<h2 id="sidebar-wtf-heading">おすすめユーザー</h2>`
- loading 行は `role="listitem" aria-busy="true"`
- avatar `<img alt="" aria-hidden="true">` (display name が冗長を避けるため装飾扱い)
- 「FollowButton」: 認証時のみ表示。component 側で `aria-pressed` / `aria-busy` を担当する
- empty / error state: `<p>` で読み上げ可能なテキスト

---

## 5. パフォーマンス

- viewer 別 cache (60 min) で recommended fetch を高速化
- popular は cache なしだがリクエスト軽量 (LIMIT 10 の単純 ORDER BY)
- 各 user 行の avatar は CloudFront 経由でキャッシュ
- WhoToFollow は client component で `useEffect` mount 時 1 回 fetch (page 切り替えごとに refetch)

---

## 6. 既知の制約・将来課題

- **Step 1 興味関心タグは未実装** (`UserInterestTag` モデルが Phase 4 以降)。MVP は Step 2 / 3 だけで運用。
- **followers_count drift**: `User.followers_count` は denormalized counter。signals + reconcile Beat で整合する想定だが、reconcile 実装は別 issue (P4 以降)。
- **Block 連動**: `apps.moderation.Block` は Phase 4B で実装。それまで `_blocked_user_ids()` は no-op。
- **キャッシュ invalidation**: フォロー / unfollow 直後の即時反映なし (60 min TTL を待つ)。Phase 8 で必要なら手動 invalidate を追加。
- **個別 reason の精度**: `recent_reaction` は単純 count、文脈 (タグ重なり等) を考慮しない。Phase 7 以降で BERT 類似度等の高度な scoring を導入するか検討。

---

## 7. テスト

### 7.1 backend

- `apps/follows/tests/test_recommended_users.py` (P2-10 で実装):
  - viewer + reaction → reason=recent_reaction
  - reaction なしの viewer → reason=popular fallback
  - 自分・既フォロー・Bot・Block 除外
  - キャッシュ hit / miss
  - limit クランプ (1〜50)
- `apps/follows/tests/test_url_routing.py` (#370 で追加):
  - `/api/v1/users/popular/` が PublicProfileView に飲まれず PopularUsersView に到達する

### 7.2 frontend

- `client/src/lib/api/__tests__/trending.test.ts`:
  - `/users/popular/` を fetch して flat な `SidebarUser` を返す (wrap shape を flatten)
  - paginated `{results: [...]}` 形式と plain array の両方で動く
  - reason の日本語 mapping (`recent_reaction` → "最近リアクションした投稿者" 等)
- `client/src/components/sidebar/__tests__/WhoToFollow.test.tsx` (将来追加可):
  - skeleton → ready の遷移
  - empty state / error state
  - reason chip 表示 (auth のみ)

---

## 8. 関連 Issue / PR

- P2-10 (#185): backend `apps/follows` services.py / views.py 実装
- P2-17 (#189): frontend WhoToFollow + RightSidebar 実装
- #370 (PR #371): `/api/v1/users/popular/` `/recommended/` のルーティング 404 fix
- #390 (PR #XXX): WhoToFollow shape unwrap fix + reason 日本語 mapping (本 PR)

## 9. 参考

### 内部参照

- [docs/SPEC.md §5.3](../SPEC.md) おすすめユーザー優先順
- [apps/follows/services.py](../../apps/follows/services.py)
- [apps/follows/views.py](../../apps/follows/views.py)
- [apps/follows/urls.py](../../apps/follows/urls.py)
- [client/src/components/sidebar/WhoToFollow.tsx](../../client/src/components/sidebar/WhoToFollow.tsx)
- [client/src/lib/api/trending.ts](../../client/src/lib/api/trending.ts)
