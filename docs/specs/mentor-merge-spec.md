# mentor surfaces merge (`/mentors?tab=requests|directory`) 仕様 (#759)

> Version: 0.1
> 作成日: 2026-05-18
> 関連 Issue: #759
> 親 audit: ui-ux-tester re-audit (2026-05-18, verdict B2)
> 親 spec: [`mentor-nav-labels-spec.md`](./mentor-nav-labels-spec.md) (#744 で label 改善、 本 PR で merge)

---

## 0. 背景

#744 では「2 surface は orthogonal (LinkedIn Jobs vs People analog)」 として verdict B (label 改善のみで 2 entry 維持) を採用したが、 ハルナさん再指摘 (2026-05-18) で ui-ux-tester 再 audit。 verdict B2 で overturn:

> Scale argument from #744 was wrong here. LinkedIn / Menta keep them split because they have 1M+ rows on each side, faceted search, etc. This product has 2 requests and 2 mentors total. A split UI for 4 rows is theater.

機能的には別物だが、 現状のデータ量 (2+2 rows) と user mental task (mentee は 1 セッションで両方を visit する) から、 タブ統合が UX 上正解。 LinkedIn analog は scale 条件が違う。

---

## 1. 変更概要

### 1.1 統合先 URL

- `/mentors?tab=requests` — 相談 board (旧 /mentor/wanted)
- `/mentors?tab=directory` — mentor 一覧 (旧 /mentors)
- `/mentors` (no query) → default は `tab=requests` (mentee 視点で「まず募集を見る」 の方が natural な entry point)

### 1.2 redirect

- `/mentor/wanted` → 301 redirect to `/mentors?tab=requests` (server-side `redirect()`)
- `/mentor/wanted/new` `/mentor/wanted/<id>` 等の sub-routes は **そのまま残す** (form / detail page は独立 surface、 redirect すると history が壊れる)

### 1.3 nav 1 entry 化

- `constants/index.ts`: 「相談を募集中」 entry 削除、 「メンター一覧」 → 「メンター」 (path `/mentors`)
- `ALeftNav.tsx`: 同様 (2 entry → 1 entry)
- `AMobileShell.tsx`: drawer に「メンター」 1 entry のみ

### 1.4 Tab UI

`MentorsModeTabs.tsx` を新規作成 (既存 `SearchModeTabs.tsx` の流儀):

- SSR-friendly Link-based tabs (client state 不要、 SEO OK)
- 2 tab: 「募集中の相談」 (requests) | 「メンター一覧」 (directory)
- active state は `?tab=<mode>` で判定
- query 文字列 (将来 `?tag=...` filter と組み合わせる場合) は preserve

### 1.5 page logic

`/mentors/page.tsx` の構造:

```tsx
const tab = searchParams?.tab === "directory" ? "directory" : "requests"; // default = requests

const [requests, mentors] = await Promise.all([
	tab === "requests" ? fetchRequestsSSR(tag) : Promise.resolve([]),
	tab === "directory" ? fetchMentorsSSR(tag) : Promise.resolve([]),
]);

return (
	<>
		<header>...{tab === "requests" ? "相談" : "メンター一覧"} CTA</header>
		<MentorsModeTabs mode={tab} tag={tag} />
		{tab === "requests" ? (
			<RequestsList items={requests} />
		) : (
			<MentorsList items={mentors} />
		)}
	</>
);
```

### 1.6 CTA 動的切り替え

- tab=requests のとき:
  - auth: 「相談を投稿する」 → /mentor/wanted/new
  - anon: 「ログインして相談する」 → /login?next=/mentor/wanted/new
- tab=directory のとき:
  - auth: 「メンターとして登録」 → /mentors/me/edit
  - anon: 「ログインしてメンター登録」 → /login?next=/mentors/me/edit

---

## 2. 修正 file (推定 ~200-250 LOC)

### 2.1 新規

- `client/src/components/mentorship/MentorsModeTabs.tsx` (~50 LOC、 SearchModeTabs 流儀)

### 2.2 修正

- `client/src/app/(template)/mentors/page.tsx` (~100 LOC 拡張): tab branching + request board content embed
- `client/src/app/(template)/mentor/wanted/page.tsx` (~5 LOC): redirect 化のみ
- `client/src/constants/index.ts` (-7 / +3): nav entry 1 化
- `client/src/components/layout-a/ALeftNav.tsx` (-3 / +1): 同
- `client/src/components/layout-a/AMobileShell.tsx` (-1 / +1): label 更新のみ
- `client/src/lib/layout/focused-surfaces.ts` (no change): /mentors と /mentor/wanted 両方 hide 済 (#758 で)

### 2.3 test 追従

- `client/e2e/mentor-board.spec.ts`: nav link 名「相談を募集中」 → 「メンター」、 navigate 先を /mentors?tab=requests に
- 既存 `MentorRequestForm.test.tsx` 等は影響なし (form 自体は変わらない)

### 2.4 spec doc

- 本 spec doc 新規
- `docs/specs/phase-11-mentor-board-spec.md` §7 route table に update note

---

## 3. やらない

- `/mentor/wanted/<id>` 詳細ページの統合 (個別 deeplinkable surface として残す)
- `/mentors/<handle>` 詳細ページの統合 (同上)
- `/mentor/contracts/*` 系 (契約 surface は別 concern)
- backend / API 変更 (`/api/v1/mentor/requests/`, `/api/v1/mentors/` はそのまま)
- 旧 `/mentor/wanted` route の完全削除 (sub-routes が残るので親 directory は維持)

---

## 4. test

### 4.1 unit

- `MentorsModeTabs` の active state / href 生成 (vitest)
- 既存 test 全 pass

### 4.2 E2E

`client/e2e/mentor-board.spec.ts` 更新:

- nav 「メンター」 link click → `/mentors?tab=requests` (default) に到達
- tab 「メンター一覧」 click → URL `/mentors?tab=directory`、 mentor cards 表示
- tab 「募集中の相談」 click → URL `/mentors?tab=requests`、 request cards 表示
- CTA 「相談を投稿する」 → `/mentor/wanted/new` に遷移
- 旧 URL `/mentor/wanted` を直 navigate → `/mentors?tab=requests` に redirect

### 4.3 完了判定

- [ ] `/mentors` (default) で tab UI が「募集中の相談」 active、 request board content 表示
- [ ] `?tab=directory` で mentor directory に切り替え
- [ ] 旧 `/mentor/wanted` 直 URL → redirect で /mentors?tab=requests
- [ ] 左 nav 「メンター」 1 entry のみ
- [ ] CTA が tab に応じて切り替わる
- [ ] anon でも tab 切り替え可能、 投稿時のみ auth gate
- [ ] tsc / lint / vitest 全 green
- [ ] stg で Playwright MCP で nav + tab 切替 + redirect を verify

---

## 5. ロールバック

- PR revert 1 発で復旧
- backend / API / DB 不変
- 既存 link / bookmark の `/mentor/wanted` は redirect 経由で動き続ける (revert しても元の page に戻るだけ)

---

## 6. 関連

- 親 audit: #744 (verdict B、 overturned)
- re-audit: 2026-05-18 ui-ux-tester (verdict B2)
- 親 spec: `docs/specs/mentor-nav-labels-spec.md`, `docs/specs/phase-11-mentor-board-spec.md`
- 連動 PR: #760 (#758 rail hide。 統合後も /mentors は rail なしの state を維持)
