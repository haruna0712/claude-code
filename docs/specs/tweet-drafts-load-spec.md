# Tweet 下書き呼び出し (composer 内) 仕様 (#767)

> Version: 0.1
> 作成日: 2026-05-18
> 関連 Issue: #767
> 関連 PR: #734 (drafts API + /drafts page)、 #762 / PR #764 (drafts nav の X 流儀整理)、 本 PR (composer 内呼び出し)
> 関連 spec: [tweet-drafts-spec.md](./tweet-drafts-spec.md), [tweet-composer-autosave-spec.md](./tweet-composer-autosave-spec.md)

---

## 0. 目的

ハルナさん指摘 (2026-05-18):

> X と同じ仕様にするなら投稿画面で下書きを呼び出せるようにするべきでは？ X の仕様を調べて同じように実装してよ。

現状 (#734 / #762 時点):

- 下書きは `/drafts` page (= profile dropdown menu からのみ到達) の **一覧 page** で編集 / 公開できる
- TweetComposer (= ホーム画面 / Compose dialog) 内には **下書きの呼び出し UI がない** → composer から書き始めた user は別途 `/drafts` page に遷移しないと過去の下書きを load できない

X (Twitter / X.com) の流儀では composer 内に「Drafts」 entry があり、 一度の click で過去の下書きを呼び出して書き続けられる。 同じ流儀をこのアプリにも入れる。

---

## 1. X の流儀 (2024-2026 web/mobile 共通)

1. composer (新規投稿 dialog) を開く → 右下に「Drafts」 text link (media icon の隣)
2. click すると modal overlay で `Drafts` 一覧が開く (新→古)
3. 各 row: body preview (1-2 行) + relative time、 tap で composer に load
4. load 後の composer は「元の draft を編集中」 状態:
   - 「下書きに保存」 push → 既存 draft を **更新** (新規作成しない)
   - 「Post」 push → 既存 draft を **公開** (= draft 削除 + 同じ ID で published tweet 作成)
5. drafts modal の右上に「Edit」 (= multi-select 削除モード切替) と close
6. draft 編集中に composer を閉じようとすると「保存しないと変更失われる」 確認 alert (= ブラウザ navigation guard)

---

## 2. やる / やらない (V1)

### やる (V1)

- DraftsLoadDialog 新規 component (modal overlay、 一覧 + 行 click で load + 削除 button)
- TweetComposer に「下書き」 entry button 追加 (右下、 「下書き保存」 button の隣)
- 編集 click で composer の **body のみ** load + `loadedDraftId` state 保持
- 「下書き保存」 push 時 `loadedDraftId` あれば PATCH /tweets/<id>/ {body}、 無ければ POST /tweets/ {body, is_draft:true}
- 「投稿」 push 時 `loadedDraftId` あれば PATCH /tweets/<id>/ {body} → POST /tweets/<id>/publish/、 無ければ POST /tweets/ {body, tags, is_draft:false}
- 削除 click → 確認 dialog → DELETE /tweets/<id>/ → 一覧から消える
- composer 閉じても draft 削除しない (= server draft はそのまま残る)
- 成功 / reset 時に `setLoadedDraftId(null)` で「新規モード」 に戻す

### やらない (別 Issue で対応)

- multi-select 削除 mode (X の Edit button)
- media / image 復元 (現状 image attachment 機能なし)
- 「保存しないと変更失われる」 navigation guard alert (autosave で書きかけ復元できるので V1 では skip)
- /drafts page の廃止 (依然 profile menu からの一覧入口として残す)
- **tag 編集** (現状 backend serializer の update が body のみ受付。 tag 編集は別 issue で backend 拡張後に対応。 V1 では load 時に composer の tags 入力は空のまま、 publish 時に user が再入力)

---

## 3. 実装方針

### 3.1 API は既存を使い回す (backend 変更最小)

| 操作            | endpoint                            | 現状                                                                             |
| --------------- | ----------------------------------- | -------------------------------------------------------------------------------- |
| 下書き一覧取得  | `GET /api/v1/tweets/drafts/`        | ✅ (`fetchDrafts`)                                                               |
| 下書き 1 件取得 | `GET /api/v1/tweets/<id>/`          | ✅ (`fetchTweet`)                                                                |
| 下書き更新      | `PATCH /api/v1/tweets/<id>/`        | ✅ (`updateTweet`、 ただし payload `{ body }` のみ → **本 PR で `tags` も対応**) |
| 下書き公開      | `POST /api/v1/tweets/<id>/publish/` | ✅ (`publishDraft`)                                                              |
| 下書き削除      | `DELETE /api/v1/tweets/<id>/`       | ✅ (`deleteTweet`)                                                               |

唯一の backend 変更: `updateTweet` payload に `tags?: string[]` を許容。 既存 serializer が draft 編集時に tags 更新を受け付けているか確認、 必要なら serializer 拡張。

### 3.2 frontend 構成

- **`client/src/components/tweets/DraftsLoadDialog.tsx`** 新規 (~150 行)

  - Radix Dialog overlay
  - mount で `fetchDrafts()` → drafts state
  - 各 row: body preview + datetime + 「編集」 (= `onPick(draft)` callback) / 「削除」 button
  - 0 件のとき empty state「下書きはまだありません」

- **`client/src/components/tweets/TweetComposer.tsx`** 改 (~50 行追加)
  - 右下に「下書き」 text button 追加 (`下書き保存` button の左隣)
  - click で DraftsLoadDialog open
  - `loadedDraftId: number | null` state 追加
  - `onPick(draft)`: composer の body / tags を draft の値で上書き、 `loadedDraftId = draft.id` 保持、 DraftsLoadDialog close、 textarea に focus 戻す
  - `saveDraft()` 既存修正: `loadedDraftId` あれば `updateTweet(loadedDraftId, { body, tags })`、 無ければ既存 `createTweet({ body, tags, is_draft: true })`
  - `submit()` 既存修正: `loadedDraftId` あれば `updateTweet(loadedDraftId, { body, tags })` → `publishDraft(loadedDraftId)`、 無ければ既存 `createTweet({ body, tags, is_draft: false })`
  - 成功 / reset 時に `setLoadedDraftId(null)` で「新規モード」 に戻す

### 3.3 UI 配置 (X と同じ)

```
+---------------------------------------+
| (avatar) [textarea            ]       |
|                                       |
| #tag1 #tag2 [Add tag…]                |
|                                       |
| 0 / 280               [下書き] [下書き保存] [投稿] |
+---------------------------------------+
```

- 「下書き」 = 過去の下書きを呼び出す (本 PR 新規)
- 「下書き保存」 = 今書いてる内容を server に保存
- 「投稿」 = 公開

---

## 4. テスト

### 4.1 Unit (Vitest)

- `DraftsLoadDialog.test.tsx`
  - **DRAFTS-LOAD-DIALOG-1**: mount で `fetchDrafts` 呼ばれる、 drafts が一覧表示される
  - **DRAFTS-LOAD-DIALOG-2**: 0 件のとき empty state 「下書きはまだありません」
  - **DRAFTS-LOAD-DIALOG-3**: 「編集」 click で `onPick(draft)` 呼ばれる
  - **DRAFTS-LOAD-DIALOG-4**: 「削除」 click → confirm → `deleteTweet` 呼ばれる、 行が消える
  - **DRAFTS-LOAD-DIALOG-5**: 401 → 「ログインが必要です」 toast
- `TweetComposerDraftLoad.test.tsx` (新規 or 既存 TweetComposerDraft.test.tsx 拡張)
  - **COMPOSER-LOAD-1**: 「下書き」 button click で DraftsLoadDialog open
  - **COMPOSER-LOAD-2**: onPick で composer の body / tags が draft 値に上書きされる、 `loadedDraftId` 保持
  - **COMPOSER-LOAD-3**: loadedDraftId あり時の `saveDraft` → `updateTweet` 呼ばれる、 `createTweet` 呼ばれない
  - **COMPOSER-LOAD-4**: loadedDraftId あり時の `submit` → `updateTweet` → `publishDraft` 連続呼ばれる
  - **COMPOSER-LOAD-5**: 成功後 `loadedDraftId` が null にリセットされる

### 4.2 E2E (Playwright on stg)

`client/e2e/tweet-drafts-load.spec.ts` 新規:

- **DRAFTS-LOAD-1**: test4 ログイン → ホーム → 「下書き」 click → DraftsLoadDialog 開く → 一覧表示
- **DRAFTS-LOAD-2**: 一覧から行 click → composer に body load される → 「投稿」 → 公開成功 (TL に表示、 /drafts から消える)
- **DRAFTS-LOAD-3**: composer 内「下書き」 click → 削除 button → 確認 → /drafts からも消える

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
  npx playwright test e2e/tweet-drafts-load.spec.ts --reporter=line
```

env は [docs/local/e2e-stg.md](../local/e2e-stg.md) 参照。

---

## 5. 受け入れ基準 (definition of done)

- [ ] composer に「下書き」 button 追加、 click で DraftsLoadDialog overlay open
- [ ] 一覧から行 click → composer に body + tags load、 loadedDraftId 保持
- [ ] loadedDraftId あり時の「下書き保存」 → 既存 draft を update (新規作成しない)
- [ ] loadedDraftId あり時の「投稿」 → 既存 draft を publish (新規作成しない)
- [ ] DraftsLoadDialog 内「削除」 button → 確認 → DELETE → 一覧から消える、 /drafts page でも消える
- [ ] 「下書きはまだありません」 empty state
- [ ] backend `updateTweet` payload に `tags` 追加 (serializer 拡張)
- [ ] vitest / E2E 全 pass
- [ ] stg Playwright で実機検証

---

## 6. ロールバック

- `DraftsLoadDialog.tsx` 削除 + `TweetComposer.tsx` の「下書き」 button + `loadedDraftId` state 削除 → V1 以前の挙動 (= /drafts page 経由のみ) に戻る
- backend serializer の tags 拡張は backward compatible (既存 client は body のみ送り続けて動く)
