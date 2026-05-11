# ArticleEditor live preview + 画像 D&D spec (#536 / PR C)

> Phase 6 P6-13 follow-up (PR C)。 frontend のみ、 backend 変更なし (既に PR #591 で画像 API は揃っている)。
>
> 関連:
>
> - [docs/issues/phase-6.md](../issues/phase-6.md) P6-13
> - 先行 PR: [#591](https://github.com/haruna0712/code/pull/591) (画像 API backend)、 [#594](https://github.com/haruna0712/claude-code/pull/594) (記事編集ループ導線)
> - 先行 spec: [article-image-upload-spec.md](./article-image-upload-spec.md) (API contract)

## 1. 背景 / 問題

既存 `client/src/components/articles/ArticleEditor.tsx` (PR #545) は ArticleEditor の **stub 実装**:

- preview pane が `whitespace-pre-wrap` で raw markdown を表示するだけで、 **rendered HTML preview ではない**
- 画像を貼る手段が無い (D&D / paste / file picker いずれも未対応)、 既存 P6-04 backend (`/articles/images/presign/` + `/confirm/`) が consumer なしで遊んでいる

「Zenn 風 Markdown エディタ」 として最低限「書きながら見た目を確認できる」 + 「画像を簡単に貼れる」 がないと書き手が使えない。 #499 / #545 / #547 で 3 回踏んだ「URL 直叩きで動いた = 完了」 の轍に該当する穴 (UI は出てるが機能していない)。

## 2. やる / やらない

### やる (PR C スコープ)

| #   | 場所                                                      | 変更                                                                                                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `client/src/lib/markdown/preview.ts` (新)                 | `react-markdown` (既存依存) を wrap した `<MarkdownPreview body={...} />` component を export。 `rehype-sanitize` (default profile) で defense-in-depth、 `<a>` の href は `https?:` / `mailto:` / 相対 path のみ accept                                                                                             |
| 2   | `client/src/lib/api/articleImages.ts` (新)                | `requestImageUpload(file) → { url, width, height, size }` の thin wrapper。 内部で `POST /articles/images/presign/` → `fetch(s3.url, FormData)` → `POST /articles/images/confirm/` の 3 step を順番に実行、 失敗時は `Error` を throw                                                                                |
| 3   | `client/src/hooks/useArticleImageUpload.ts` (新)          | upload state machine (`queued` / `uploading` / `done` / `failed`)、 progress 配列を返す。 file を受けて `requestImageUpload` を呼ぶ薄い hook                                                                                                                                                                         |
| 4   | `client/src/components/articles/ArticleEditor.tsx` (修正) | preview pane を `<MarkdownPreview>` に置換、 textarea に `onDrop` + `onPaste` event handler + 「画像を追加」 button (`<input type=file accept="image/*" multiple hidden>`) を追加、 upload 完了で markdown 本文に `![filename](url)` を caret 位置に挿入、 upload 進行中の uploading rows を preview pane 上部に表示 |

### やらない (このスコープ外、 別 issue 持ち越し)

- **自動保存 (30 秒 ごと PATCH)** — P6-13 issue 元 scope だが ad-hoc な debouce + race 設計が必要なので別 issue
- **emoji picker** — P6-13 元 scope、 別 issue
- **tag autocomplete** — P6-13 元 scope、 既存 Tag マスタ消費 API が必要、 別 issue
- **`@uiw/react-md-editor`** など重い WYSIWYG component の導入 — react-markdown で MVP は十分、 後継 issue で検討
- **code block syntax highlighting** in preview — preview は plain code block で十分、 backend (pygments) で公開後に highlight される
- **slow 3G / 大量ファイル D&D の UX 最適化** — 5 件まで concurrent / それ以降は queue にする等、 別 issue
- **動画 / 任意 file 添付** — SPEC §12 が image のみ
- **画像 alt 編集 UI** — markdown 文字列で `![alt](url)` を手編集する想定、 専用 UI は別 issue

## 3. UX / 詳細設計

### 3.1 Markdown preview

````
preview pane (右側、 split lg+):
┌────────────────────────────────────────┐
│ # タイトル                              │  ← <h1> rendered
│                                         │
│ 本文 paragraph。 **太字** や *italic*    │  ← prose-style
│ や `inline code` を表示。               │
│                                         │
│ ![](https://cdn.example.com/foo.png)    │  ← <img> rendered
│                                         │
│ ```python                               │  ← <pre><code>
│ print("hello")                          │     (highlight 無し、 plain)
│ ```                                     │
└────────────────────────────────────────┘
````

- `react-markdown` (default plugins) + `rehype-sanitize` (`defaultSchema` ベース、 `img` の src は CloudFront / 相対のみ allowlist)
- `prose` Tailwind class (既存 `ArticleBody` と同流儀) で typography 整形
- empty 時は `(本文がここに表示されます)` placeholder

### 3.2 画像 upload flow

```
[file 入手] (D&D / paste / file picker)
  ↓
[validate] file.type が image/{jpeg,png,webp,gif}、 file.size <= 5 MiB
  ↓ (NG なら toast.error + skip)
[uploading row 表示] preview pane 上部に「アップロード中: foo.png」
  ↓
POST /articles/images/presign/  { filename, mime_type, size }
  ↓ → { url, fields, s3_key, expires_at }
POST <s3.url>  FormData (fields + file)  (content-length-range / mime / key を S3 で強制)
  ↓ → 204 No Content
[client-side で naturalWidth/Height 取得 (Image() + onload)]
  ↓
POST /articles/images/confirm/  { s3_key, filename, mime_type, size, width, height }
  ↓ → 201 { id, url, ... }
[markdown 挿入]
  - textarea の caret 位置に `\n![filename](url)\n` を insert (改行で行頭/行末を保証)
  - 行末でなければ前後に改行を補完
  - upload row を rows state から削除 + toast.success("画像を追加しました")
```

失敗パス:

- presign 400 (size 超 / mime 不許可): toast.error + uploading row を「失敗」 状態に変えて 5 秒後に消す
- S3 PUT 失敗 (network / 403): 同上
- confirm 400 (size mismatch 等): 同上
- 各失敗で markdown 本文には挿入しない (orphan S3 object は P6-04 spec の lifecycle で回収)

### 3.3 上限 / 制約

- **同時 upload**: 最大 3 並列、 それ以上は queue (FIFO)。 大量 D&D で UX が崩れない最低ライン
- **drop area**: textarea 全面 (`onDrop` + `preventDefault`)、 drag over 中は textarea border を accent color にして hint
- **paste**: textarea にクリップボードから画像が paste されたら自動 upload (画像以外の paste は通常通り text 挿入)
- **file picker**: textarea 上にある「画像を追加」 button (icon + label)、 `multiple` attribute で複数 select 可

## 4. データ層

PR #591 で実装済の API contract:

```
POST /api/v1/articles/images/presign/
  body: { filename, mime_type, size }
  resp: { url, fields, s3_key, expires_at }

POST /api/v1/articles/images/confirm/
  body: { s3_key, filename, mime_type, size, width, height }
  resp: { id, s3_key, url, width, height, size, created_at }
```

frontend lib に `requestImageUpload(file)` wrapper を新設、 3 step を直列実行 + S3 PUT は `fetch(url, { method: "POST", body: formData })`。 axios の CSRF token は serialiser 内で扱う。

## 5. テスト

### 5.1 vitest

`client/src/lib/markdown/__tests__/preview.test.tsx` (新、 ~5 ケース):

- T-MD-1 paragraph / bold / italic / inline code / link が render される
- T-MD-2 `<script>` / `javascript:` href / `onerror` 等が sanitize される
- T-MD-3 image src の allowlist (CloudFront / 相対は OK、 外部 origin は default schema で hesitate)
- T-MD-4 fenced code block が `<pre><code>` で render
- T-MD-5 empty body で placeholder

`client/src/hooks/__tests__/useArticleImageUpload.test.tsx` (新、 ~5 ケース):

- T-UPLOAD-1 valid file → uploading → done に遷移、 upload 結果 url が返る
- T-UPLOAD-2 size 超 → validation 失敗、 API 呼ばない
- T-UPLOAD-3 mime 不許可 → validation 失敗
- T-UPLOAD-4 presign 400 → state=failed、 markdown 挿入されない
- T-UPLOAD-5 同時 3 並列、 4 件目は queue

`client/src/components/articles/__tests__/ArticleEditor.test.tsx` (新 or 拡張、 ~3 ケース):

- T-EDIT-1 preview pane に rendered HTML が出る
- T-EDIT-2 paste 画像 file → markdown に `![]()` 挿入
- T-EDIT-3 drop 画像 → 同上

### 5.2 Playwright E2E `client/e2e/article-editor-image.spec.ts`

シナリオ:

- ARTICLE-EDITOR-IMG-1: /articles/new で「画像を追加」 button 経由でファイル選択 → upload 成功 → markdown に挿入 → preview で `<img>` 表示
- ARTICLE-EDITOR-IMG-2: 5MB 超ファイルを drop → toast.error、 markdown に挿入されない

**E2E 未網羅 gap** (code-reviewer LOW-2 反映): clipboard paste 経由の upload は
Playwright で本物の clipboard event を発火させるのが難しいため **E2E 未網羅**。
vitest 単体テスト (`T-EDIT-4` paste with image / `T-EDIT-5` paste with non-image) で
`fireEvent.paste` を使って component 単体の振る舞いだけ verify している。 同様に drop は
T-EDIT-6 / T-EDIT-7 で vitest 網羅。 将来 Playwright で
`page.evaluate(() => dispatchEvent(new ClipboardEvent(...)))` での網羅を検討。

実行:

```bash
PLAYWRIGHT_BASE_URL=https://stg.codeplace.me \
PLAYWRIGHT_USER1_EMAIL=test2@gmail.com \
PLAYWRIGHT_USER1_PASSWORD=Sirius01 \
PLAYWRIGHT_USER1_HANDLE=test2 \
  npx playwright test client/e2e/article-editor-image.spec.ts
```

## 6. ファイル変更まとめ

```
client/src/lib/markdown/
  preview.tsx                          [新 ~50 行]   <MarkdownPreview> component
  __tests__/preview.test.tsx           [新 ~80 行]   T-MD-1..5

client/src/lib/api/
  articleImages.ts                     [新 ~80 行]   requestImageUpload() 3-step wrapper

client/src/hooks/
  useArticleImageUpload.ts             [新 ~120 行]  state machine + queue + parallel limit
  __tests__/useArticleImageUpload.test.tsx [新 ~150 行]  T-UPLOAD-1..5

client/src/components/articles/
  ArticleEditor.tsx                    [既存 +100 行] preview 置換 + D&D / paste / picker
  __tests__/ArticleEditor.test.tsx     [新 ~100 行]  T-EDIT-1..3

client/e2e/
  article-editor-image.spec.ts         [新 ~80 行]   ARTICLE-EDITOR-IMG-1..2

docs/specs/
  article-editor-enhancements-spec.md  [新、 本ファイル]
```

合計概算 ≈ 760 行 (test + spec 除いて ≈ 350 行)。 small PR ガイドライン (500 行) 範囲内。

## 7. CLAUDE.md §4.5 step 6 完了チェックリスト

- [ ] Playwright spec ファイル新設、 シナリオがコード化されている
- [ ] テストシナリオを spec doc に書いた (本 §5.2)
- [ ] ホーム 3 click 以内 (ホーム → /articles → 「記事を書く」 = 2 click、 既存)
- [ ] 未ログイン / 他人で踏んでも壊れない (auth guard は既存、 本 PR で touch しない)
- [ ] 完了シグナル (画像 upload 完了で toast.success + markdown 挿入)
- [ ] stg Playwright 第一選択
- [ ] `gan-evaluator` agent: frontend UI 大変更なので **必須** (stg 反映後)

## 8. follow-up issue 起票予定

PR C と独立した P6-13 残務 (本 PR スコープ外):

- 自動保存 (30 秒ごと PATCH) — race / debounce 設計が必要
- emoji picker — 既存 emoji-mart 等の選定
- tag autocomplete — 既存 Tag マスタ消費 API が前提
