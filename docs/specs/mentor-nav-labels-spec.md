# mentor nav label refactor 仕様 (#744)

> Version: 0.1
> 作成日: 2026-05-17
> 関連 Issue: #744
> 関連 audit: ui-ux-tester 2026-05-17 (verdict B、 ship now)

---

## 0. 背景

#741 audit が「左 nav の『メンター募集』 と『メンターを探す』 は同じ mental model に見える」 と LOW で flag。 #744 として起票したが Phase 11 review で方針を決めるため open のまま放置していた。

2026-05-17 に Phase 11 nav の review として ui-ux-tester agent に audit させた結果、 **Option B (label 改善)** が verdict。 機能的には 2 surface は orthogonal なので統合は wrong abstraction、 単に label を「メンター」 で始まる類似名にしているのが問題。

---

## 1. 真の問題

`/mentor/wanted` と `/mentors` は **functionally distinct**:

- `/mentor/wanted` = **request board** (job-posting analog): mentee が「教わりたい」 を投稿、 mentor が提案
- `/mentors` = **people directory** (freelancer marketplace analog): mentor が profile + plans を公開、 mentee が browse

LinkedIn の「Jobs」 vs 「People」、 Menta (Phase 11 inspiration source) の「相談を探す」 vs 「メンターを探す」 と同じ orthogonal な surface。 統合してはダメ (#744 issue 本文の Option A は overruled)。

問題は label のみ:

- 「メンター募集」 / 「メンターを探す」 → 両方 4-6 char + 「メンター」 で始まる + Handshake/Users icon (どちらも people-related) → first-time visitor が「memorize before click」 を強いられる
- 「探す」 が広すぎて「人を検索する」 とも「募集を検索する」 とも取れる

---

## 2. 変更内容

### 2.1 label rename pair

audit recommendation:

- **`/mentor/wanted` (Handshake icon)**: 「メンター募集」 → **「相談を募集中」**

  - 「メンター」 を label から外して synonym collision を断つ
  - 「募集中」 は board に並んでる現在進行形の request を端的に表現

- **`/mentors` (Users icon)**: 「メンターを探す」 → **「メンター一覧」**
  - 「〜一覧」 は日本語 SaaS UI で directory を示す最強 signal (cf.「ユーザー一覧」「商品一覧」)
  - 「メンター」 アンカーは directory 側に残して semantic continuity を保つ

Final pair: **「相談を募集中」** + **「メンター一覧」** — first char distinct (相 vs メ)、 noun distinct (相談 vs メンター)、 verb 不要 / 名詞句で完結。

### 2.2 修正 file

#### Nav definitions (3 files、 issue scope)

- `client/src/constants/index.ts:57` (leftNavLinks の Phase 11 entry)
- `client/src/components/layout-a/ALeftNav.tsx:86, 88` (A direction nav の 2 entry)
- `client/src/components/layout-a/AMobileShell.tsx:269` (mobile drawer)

#### Page-internal h1 / metadata title (whiplash 防止)

nav label を変えると user は「相談を募集中」 を click → page h1 が「メンター募集」 だと違和感。 同時に揃える:

- `client/src/app/(template)/mentor/wanted/page.tsx`: metadata title + h1
- `client/src/app/(template)/mentor/wanted/[id]/page.tsx`: metadata title suffix
- `client/src/app/(template)/mentor/wanted/new/page.tsx`: metadata title + h1
- `client/src/app/(template)/mentors/page.tsx`: metadata title + h1
- `client/src/app/(template)/mentors/[handle]/page.tsx`: back link text

### 2.3 やらない (out of scope)

- `MentorRequestForm.tsx` の aria-label「メンター募集フォーム」 → form 自体の name で nav と独立、 残す
- `app/layout.tsx` の site description「..., メンター募集, ...」 → top-level marketing copy、 別 issue で SEO 最適化と一緒に
- backend / API の field 名 (`mentor_request`, `MentorRequest` model) は変更しない
- backend route (`/api/v1/mentor/requests/`) は変更しない

---

## 3. test

### 3.1 既存 test 影響

- nav に関する vitest test (`LeftNavbar.test.tsx` 等) は label を実 string で assertion していないので影響なし
- `MentorRequestForm.test.tsx` は form aria-label「メンター募集フォーム」 を使っているが本 PR で form 名は変えないので影響なし

### 3.2 E2E

既存 `client/e2e/mentor-board.spec.ts` 等が h1 / nav label を実 string で assertion していたら更新が必要。 PR 内で grep して該当があれば一括更新。

### 3.3 完了判定

- [ ] 3 nav file で label 変更済 (constants / ALeftNav / AMobileShell)
- [ ] 5 page file で h1 + metadata title 変更済
- [ ] tsc / lint / vitest 全 green
- [ ] stg で nav 確認: 「相談を募集中」「メンター一覧」 が並んで表示、 click で対応 route に遷移
- [ ] 各 page の h1 / browser tab title が新 label と一致 (whiplash なし)

---

## 4. ロールバック

label 変更のみ、 PR revert 1 発で復旧。 backend / API / DB 触らない。 SEO は metadata title 変更で site:検索結果が一時的に古い title になる可能性あるが、 数日で再 indexing される。

---

## 5. 関連

- 親 audit: #741 ui-ux-tester L-2
- Phase 11 spec: `docs/specs/phase-11-mentor-board-spec.md` §7 (route table、 本 PR で route は変更しない、 label のみ)
