# DM 添付メッセージ表示 — 受け入れシナリオ

> 関連: [dm-attachment-display-spec.md](./dm-attachment-display-spec.md), [dm-attachment-display-e2e-commands.md](./dm-attachment-display-e2e-commands.md)
>
> Gherkin 風の自然文。Playwright spec はこれを 1 対 1 でカバーする。

## 表示

### A-01: 1 枚画像が inline 表示される

**Given** test2 が test3 との DM ルームを開いている
**When** 📎 から PNG 1 枚を選び送信する
**Then** メッセージ bubble 内に `<img>` が visible
**And** `alt` 属性 = filename
**And** `width` / `height` 属性が number で設定されている
**And** `src` は `https://stg.codeplace.me/dm/...` の CloudFront URL

### A-02: 複数枚は grid 配置

**Given** 4 枚の画像を一度に添付して送信
**When** 受信側で表示
**Then** 2x2 grid で 4 枚すべて render される

### A-03: 5 枚超は「+N」overlay

**Given** 6 枚の画像を一度に添付して送信
**When** 受信側で表示
**Then** 4 枚目の右下に「+2」overlay が出る
**And** overlay クリックで lightbox が起動し、全 6 枚が見れる

### A-04: 非画像はファイル chip

**Given** PDF 1 ファイル + 画像 1 枚を添付して送信
**When** 受信側で表示
**Then** PDF は chip (📄 + filename + size + ダウンロード) で表示
**And** 画像は inline `<img>` で表示

### A-05: width/height 不在のフォールバック

**Given** Phase 3 既存の attachment row (width=null, height=null)
**When** 受信側で表示
**Then** `<img>` は max-height:360px / object-fit:contain で破綻しない

## Lightbox

### L-01: 画像クリックで lightbox 起動

**When** inline 画像をクリックする
**Then** lightbox モーダルが開く
**And** `role="dialog"` `aria-modal="true"` が付与
**And** 中央に full-resolution `<img>` が object-fit:contain で表示
**And** filename / size がヘッダーに見える

### L-02: ESC で閉じる

**Given** lightbox 開いている
**When** ESC キーを押す
**Then** lightbox が閉じ、開く前の focus 元 (画像 thumbnail) に focus が戻る

### L-03: 外側 click で閉じる

**Given** lightbox 開いている
**When** モーダル背景をクリックする
**Then** lightbox が閉じる

### L-04: 複数画像で ←→ ナビ

**Given** 4 枚画像メッセージで lightbox 起動 (1 枚目から)
**When** → キーを押す
**Then** 2 枚目に切り替わる、ヘッダー「2 / 4」表示
**When** ← キーで 1 枚目に戻る、← で 4 枚目に wrap
**When** → で 1 枚目に wrap

### L-05: lightbox 内ダウンロード

**Given** lightbox 開いている
**When** ダウンロードボタンを click
**Then** `<a download>` で OS ダウンロードダイアログが起動 (Playwright で download event 検出)

### L-06: focus trap

**Given** lightbox 開いている
**When** Tab を押し続ける
**Then** 操作可能要素 (× ボタン / ←→ / ダウンロード) を循環
**And** 外側の要素には focus が抜けない

### L-07: prefers-reduced-motion

**Given** OS / browser が prefers-reduced-motion: reduce
**When** lightbox を開く
**Then** scale アニメーションは無効、fade のみ

## ダウンロード

### D-01: ファイル chip からダウンロード

**Given** PDF 添付メッセージが受信されている
**When** 受信者が chip 内ダウンロード button (or chip 全体) をクリック
**Then** ブラウザのダウンロードダイアログ起動 (Playwright `page.waitForEvent('download')` で検出)
**And** suggested filename = 元の filename

## 寸法計測

### M-01: 画像 upload 時 width/height が confirm payload に含まれる

**Given** test2 が PNG (1296x952) を 📎 で選択
**When** uploadAttachment が presign → S3 PUT → confirm の confirm payload を組み立て
**Then** confirm payload に `width=1296, height=952` が含まれる

### M-02: 非画像で width/height は null

**Given** test2 が PDF を 📎 で選択
**When** confirm payload 組み立て
**Then** payload の width/height は null (or undefined)

### M-03: backend 受領 + DB 保存

**Given** confirm に `width=1296, height=952` が来る
**When** confirm_attachment が呼ばれる
**Then** MessageAttachment row の width=1296, height=952 が保存される

### M-04: backend で non-image MIME に width/height が来ても無視

**Given** mime_type=application/pdf で width=100 が来る
**When** confirm_attachment が呼ばれる
**Then** DB 保存値は width=null, height=null (image でない MIME なので強制 None)

## URL 組み立て

### U-01: serializer の url が CloudFront 形式

**Given** s3_key = "dm/1/2026/05/abc.png" の attachment
**When** message GET API で取得
**Then** `attachments[0].url == "https://stg.codeplace.me/dm/1/2026/05/abc.png"`

### U-02: env 未設定で起動失敗

**Given** DM_ATTACHMENT_BASE_URL 未設定
**When** Django 起動
**Then** ImproperlyConfigured が raise (silent failure 化禁止)

## a11y

### Y-01: 画像 alt は filename

**When** image inline 表示
**Then** `<img alt="otAame_screenshot.png">` (空 alt 禁止)

### Y-02: lightbox 開閉のキーボード操作完結

**Given** キーボードのみ
**When** Tab で thumbnail に focus → Enter で lightbox 起動 → Tab で × button → Enter で閉じ
**Then** マウス無しで完結、focus trap 通る
