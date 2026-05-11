# 記事保存 / 公開時の toast 通知 (#607)

> 関連 Issue: #607
> 関連 PR: TBD
> 種別: UX fix (frontend)

## 1. 背景

`gan-evaluator` agent の MEDIUM M1 として発見。

`/articles/new` で記事を書いて「公開する」 button を click → 確認 dialog 「OK」 → 詳細ページに遷移するが、 **toast 通知が一切出ない**。 user は「click が効いた? 失敗していない?」 と一瞬迷う UX。

`/articles/<slug>` の削除 flow は `toast.success("削除しました")` を出している (`client/src/components/articles/ArticleOwnerActions.tsx`) ので非対称。

## 2. 直し方

`client/src/components/articles/ArticleEditor.tsx` の `handleSubmit` 内、 `createArticle` / `updateArticle` の成功直後・ `router.push` の前に `toast.success(...)` を追加:

```diff
 if (mode === "create") {
   const created = await createArticle({...});
+  toast.success(status === "published" ? "公開しました" : "下書きを保存しました");
   router.push(`/articles/${created.slug}`);
 } else if (initial) {
   const updated = await updateArticle(initial.slug, {...});
+  toast.success(status === "published" ? "公開しました" : "下書きを保存しました");
   router.push(`/articles/${updated.slug}`);
 }
```

`toast` は既に line 31 で `import { toast } from "react-toastify"` 済 (画像 upload 通知で利用)、 追加 import 不要。

メッセージは「公開しました」 / 「下書きを保存しました」 で create / update を区別しない (UX として「保存できた」 ことだけ伝われば十分、 削除 toast 「削除しました」 と対称)。

### 採用しない選択肢

- **toast.info() を使う**: 削除 toast が success なので一貫性を取る。
- **「記事を更新しました」 などモードを分ける**: gan-evaluator 指摘は「保存できたか分からない」 で、 詳細度を上げると逆に SR / 視覚負荷が増えるのでシンプルに保つ。

## 3. 受け入れ基準

- [ ] create + draft → `toast.success("下書きを保存しました")` が呼ばれる
- [ ] create + published → `toast.success("公開しました")` が呼ばれる
- [ ] edit + draft → `toast.success("下書きを保存しました")`
- [ ] edit + published → `toast.success("公開しました")`
- [ ] エラー path (保存失敗) では toast.success は呼ばれない (既存 `setError` のみ、 regression なし)
- [ ] vitest で 4 ケース (T-PUBLISH-1..4) 追加して緑

## 4. テスト

### Unit (vitest)

`client/src/components/articles/__tests__/ArticleEditor.test.tsx` に 4 ケース追加:

| ID          | mode   | status    | 期待 toast             |
| ----------- | ------ | --------- | ---------------------- |
| T-PUBLISH-1 | create | draft     | "下書きを保存しました" |
| T-PUBLISH-2 | create | published | "公開しました"         |
| T-PUBLISH-3 | edit   | draft     | "下書きを保存しました" |
| T-PUBLISH-4 | edit   | published | "公開しました"         |

`createArticle` / `updateArticle` を vi.hoisted で mock し、 各テストで成功 resolve を返す。 published 時の `window.confirm` は `vi.spyOn(window, "confirm").mockReturnValue(true)` で auto-accept。

### Visual (Playwright MCP / stg)

stg 反映後、 USER1 で `/articles/new` → published + confirm OK → `toast「公開しました」` が画面右下 (react-toastify default) に表示されるのを screenshot 確認。 同様に draft, edit, edit+publish も踏む。

## 5. ロールアウト

- `fix/issue-607-publish-toast` branch で PR を出し、 CI 緑なら squash merge
- main merge 後、 stg CD で deploy → Playwright MCP / 手動で 4 case 確認
- gan-evaluator 再採点で M1 解消を確認
