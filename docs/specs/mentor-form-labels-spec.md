# mentor form / CTA label 統一 仕様 (#753 + #754)

> Version: 0.1
> 作成日: 2026-05-17
> 関連 Issue: #753, #754
> 親 spec: [`mentor-nav-labels-spec.md`](./mentor-nav-labels-spec.md) (#744、 nav label 改修)

---

## 0. 背景

#744 で nav label を「メンター募集」 → 「相談を募集中」 / 「メンターを探す」 → 「メンター一覧」 に rename したが、 spec §2.3 で意図的に out-of-scope とした 2 つの surface に旧 terminology が残存:

1. **`MentorRequestForm.tsx` aria-label「メンター募集フォーム」** (#753):
   screen reader user が page (「相談を投稿する」 h1) を聞いた直後に form を聞くと「メンター募集フォーム」 と読み上げられ whiplash

2. **`/mentor/wanted` の「募集を出す」 CTA** (#754):
   page header「相談を募集中」 と同じ header 内の CTA が「募集を出す」 で、 「募集」 が 2 度出てきて意味が二重 (header = 状態、 CTA = action)。 さらに遷移先 h1「相談を投稿する」 と verb が齟齬

両 issue は code-reviewer (#744 review) で LOW として上がった指摘で、 cross-link 上「セットで進める」 と合意済。 本 PR で 1 つの terminology unification concern としてまとめて処理する。

---

## 1. 変更内容

### 1.1 #753: MentorRequestForm aria-label

`client/src/components/mentorship/MentorRequestForm.tsx:84`:

```diff
- aria-label="メンター募集フォーム"
+ aria-label="相談募集フォーム"
```

選択肢 A 採用 (#753 issue 本文より、 「メンター」 部分だけ「相談」 に置換、 minimal change で page との semantic 一致)。

### 1.2 #753 ついで修正: submit button

同じ form の submit button (`MentorRequestForm.tsx:156`) も「募集を投稿する」 → 「相談を投稿する」 に変更:

```diff
- {submitting ? "投稿中…" : "募集を投稿する"}
+ {submitting ? "投稿中…" : "相談を投稿する"}
```

理由: form name (aria-label) が「相談募集フォーム」 になるので、 submit button も「相談を投稿する」 で内部一貫性。 page h1「相談を投稿する」 とも一致。

### 1.3 #754: `/mentor/wanted` CTA

`client/src/app/(template)/mentor/wanted/page.tsx:104`:

```diff
- {isAuthenticated ? "募集を出す" : "ログインして募集する"}
+ {isAuthenticated ? "相談を投稿する" : "ログインして相談する"}
```

選択肢 A 採用 (#754 issue 本文より、 max consistency。 遷移先 `/mentor/wanted/new` の h1「相談を投稿する」 + form submit button「相談を投稿する」 と完全 alignment)。

`page.tsx:5` の JSDoc comment 内の文字列も追従:

```diff
- * 「募集を出す」 CTA を auth のみで表示、 anon は「ログインして募集する」 で
+ * 「相談を投稿する」 CTA を auth のみで表示、 anon は「ログインして相談する」 で
```

### 1.4 test 追従 (2 files)

- `client/src/components/mentorship/__tests__/MentorRequestForm.test.tsx`: 5 件の `getByLabelText("メンター募集フォーム")` を「相談募集フォーム」 に更新
- `client/e2e/mentor-board.spec.ts`: 4 件 (「募集を出す」 link / 「募集を投稿する」 button / 「ログインして募集する」 link / comment) を新 label に追従

---

## 2. やらない

- form 内の field label / placeholder (「タイトル」「本文」 等は機能名でそのまま)
- backend / API / model 名 (`MentorRequest`, `mentor_request`) は変更しない
- 「相談」 terminology を他 surface (timeline / DM / 通知) に伝播させる作業は別 PR

---

## 3. test

### 3.1 unit (vitest)

- 既存 `MentorRequestForm.test.tsx` の 5 case が新 aria-label で全 green
- 既存 `tsc / lint` 全 green
- 全 vitest suite (100+ files) regression なし

### 3.2 E2E (stg、 spot check)

- `client/e2e/mentor-board.spec.ts` MENTOR-1 golden path が新 label で全 pass
- stg 反映後に Playwright MCP で `/mentor/wanted` を踏み、 CTA「相談を投稿する」 が表示、 click で `/mentor/wanted/new` に遷移、 form submit button「相談を投稿する」 が表示を確認

### 3.3 完了判定

- [ ] aria-label / button / link の 4 string が全 surface で「相談」 系に統一
- [ ] grep で `client/src/` `client/e2e/` 配下に「メンター募集フォーム」「募集を出す」「ログインして募集する」「募集を投稿する」 が残っていない (spec doc / comment は除く)
- [ ] tsc / lint / vitest 全 green
- [ ] stg で screen reader (or DOM `aria-label` 確認) で form が「相談募集フォーム」 と認識される

---

## 4. ロールバック

PR revert 1 発で復旧。 backend / API / DB / route 触らない。 4 file の string 変更のみ。

---

## 5. 関連

- 親 audit: #741 ui-ux-tester L-2
- 親 PR: #752 / #744 (nav label rename、 §2.3 で本 issue を out-of-scope と明示)
- code-reviewer review of #752 で LOW として指摘
