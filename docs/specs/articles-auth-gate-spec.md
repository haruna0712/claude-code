# /articles/new + /articles/<slug>/edit の SSR auth gate (#606)

> 関連 Issue: #606
> 関連 PR: TBD
> 種別: security fix / UX fix (frontend)

## 1. 背景

`gan-evaluator` agent の HIGH バグ H2 として発見。

`/articles/me/drafts` は PR #594 で `cookies().get("logged_in")` を見て server-side で `/login?next=...` に redirect していたが、 `/articles/new` と `/articles/<slug>/edit` はその対応が漏れており、 anon (未ログイン) でも editor form が render されていた。 さらに `/edit` は他人の published 記事の URL を踏むと title / body / slug が編集 form に乗った状態で見えてしまっていた (情報漏洩は無いが UX 違和感)。

### 再現

| URL                                  | 期待                              | 現状 (修正前)           |
| ------------------------------------ | --------------------------------- | ----------------------- |
| anon `/articles/new`                 | 307 → `/login?next=/articles/new` | 200 + editor form       |
| anon `/articles/<slug>/edit`         | 307 → `/login?next=...`           | 200 + 他人の記事の form |
| auth (他人) `/articles/<slug>/edit`  | 404 (notFound)                    | 200 + 他人の記事の form |
| auth (owner) `/articles/<slug>/edit` | 200 + editor                      | 200 (現状通り)          |

## 2. 直し方

### `/articles/new/page.tsx`

`/articles/me/drafts/page.tsx` と同じ pattern:

```ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default function NewArticlePage() {
	const isAuthenticated = cookies().get("logged_in")?.value === "true";
	if (!isAuthenticated) {
		redirect("/login?next=/articles/new");
	}
	// ...editor render
}
```

### `/articles/[slug]/edit/page.tsx`

1. cookie で auth gate (anon → /login)
2. `Promise.all([fetchArticle, fetchCurrentUserSSR])` で記事と current user を並列取得
3. 記事 404 or owner mismatch → `notFound()` (404)

owner 判定は detail page (`/articles/[slug]/page.tsx:107`) と同じく `currentUser.username === article.author.handle` で行う。 `ArticleAuthor.id` は serializer 未公開なので handle で照合。

```ts
const isAuthenticated = cookies().get("logged_in")?.value === "true";
if (!isAuthenticated) redirect(`/login?next=/articles/${params.slug}/edit`);

const [article, currentUser] = await Promise.all([
	fetchArticle(params.slug),
	fetchCurrentUserSSR(),
]);
if (!article) notFound();
if (!currentUser || currentUser.username !== article.author.handle) notFound();
```

### 採用しない選択肢

- **middleware で auth gate を集約**: 既存 page は個別に `cookies().get("logged_in")` で gate しているので一貫性を保つ。 middleware 化は別タスクとして将来検討 (今やると影響範囲が広い)。
- **/edit で `redirect("/articles/<slug>")` に飛ばす**: notFound (404) のほうが「ここは編集できる場所ではない」 ことが明示的で、 他人記事の存在を匂わせない。

## 3. 受け入れ基準

- [ ] anon `/articles/new` → 307 redirect to `/login?next=/articles/new`
- [ ] anon `/articles/<other>/edit` → 307 redirect to `/login?next=...`
- [ ] auth で他人の `/edit` を叩く → 404
- [ ] auth で自分の `/edit` を叩く → 200 (regression なし)
- [ ] `npx tsc --noEmit` 通過
- [ ] Playwright e2e `article-edit-loop.spec.ts` に EDIT-LOOP-6, 7, 8 を追加して stg 緑

## 4. テスト

### E2E (Playwright on stg)

`client/e2e/article-edit-loop.spec.ts` に 3 ケース追加:

| 名前        | シナリオ                                       |
| ----------- | ---------------------------------------------- |
| EDIT-LOOP-6 | anon `/articles/new` → /login?next= redirect   |
| EDIT-LOOP-7 | anon 他人記事 `/edit` → /login?next= redirect  |
| EDIT-LOOP-8 | auth (USER2) 他人 (USER1) 記事の `/edit` → 404 |

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=... PLAYWRIGHT_USER1_PASSWORD=... PLAYWRIGHT_USER1_HANDLE=... \
PLAYWRIGHT_USER2_EMAIL=... PLAYWRIGHT_USER2_PASSWORD=... PLAYWRIGHT_USER2_HANDLE=... \
  npx playwright test e2e/article-edit-loop.spec.ts
```

env は [docs/local/e2e-stg.md](../local/e2e-stg.md) に test2 / test3 の credential 記載済み。

### 手動視認 (Playwright MCP)

- anon で `/articles/new` を踏み、 login へ飛ぶことを screenshot 確認
- anon で他人記事の `/edit` URL を踏み、 login へ飛ぶ
- 自分 (USER1) で自分の `/edit` を踏み、 editor が出るのを確認 (regression)
- USER2 で USER1 の published `/edit` を踏み、 404 page が出るのを確認

## 5. ロールアウト

- `fix/issue-606-articles-auth-gate` branch で PR を出し、 CI 緑なら squash merge
- main merge 後 5 〜 10 分で stg CD 更新
- stg で Playwright spec を実行、 緑を確認したら issue close
