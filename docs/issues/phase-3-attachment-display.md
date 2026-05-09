# Phase 3 follow-up: DM 添付メッセージ表示 (Teams 級 UX) — Issue 一覧

> マイルストーン: `Phase 3: DM` (新マイルストーンは作らない)
> 関連: [dm-attachment-display-spec.md](../specs/dm-attachment-display-spec.md), [dm-attachment-display-scenarios.md](../specs/dm-attachment-display-scenarios.md), [dm-attachment-display-e2e-commands.md](../specs/dm-attachment-display-e2e-commands.md)
>
> ハルナさん指示: 「画像を添付して送信したらメッセージ中で画像を見れるようにしてくれますか？teams のチャットとかと同じようにしてくれますか？」
>
> Phase 3 で添付フロー (presign → S3 → confirm → WS) は完成済、PR #457 で 📎 ボタン UI 統合済。本 phase は **送信後の表示** を Teams 級 UX に。

## 設計判断

- DM_ATTACHMENT_BASE_URL は CloudFront 配信ドメイン (= app_fqdn) を流用 (既存 `/dm/*` → S3 routing)
- focus trap は既存依存の `@radix-ui/react-dialog` を再利用
- 5 枚超の grid は 2x2 + 「+N」overlay (Teams 流)
- lightbox は同一メッセージ内のみ (room 全体スワイプは別 issue)
- 新マイルストーンは作らず Phase 3 の follow-up として運用

---

## A1. [feature][dm] MessageAttachment serializer に url field を追加

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S
- **Depends-on**: なし

### 目的

frontend が `<img src>` / `<a href>` に直接使える URL を backend で組み立て、frontend からの URL 構築ロジックを排除する。

### 作業内容

- [ ] `apps/dm/serializers.py` `MessageAttachmentSerializer` に `url = SerializerMethodField()` 追加
- [ ] `get_url(obj)` は `settings.DM_ATTACHMENT_BASE_URL.rstrip("/") + "/" + obj.s3_key`
- [ ] `config/settings/base.py` に `DM_ATTACHMENT_BASE_URL = getenv(...)`、未設定で起動時 `ImproperlyConfigured` raise
- [ ] `.envs/.env.local` / `.envs/.env.example` に env var 追加
- [ ] terraform `modules/services/main.tf` に env 追加 (`https://${var.app_fqdn}`)
- [ ] tests/test_serializers.py: url field の存在 / 連結

### 受け入れ基準

- [ ] message GET API のレスポンスで `attachments[].url` が CloudFront URL
- [ ] env 未設定で Django が起動失敗
- [ ] 既存 attachment row も新 url field が出る (migration 不要)

---

## A2. [feature][dm] confirm_attachment で width/height を保存

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M
- **Depends-on**: なし (#A1 と並列可だが本 phase は直列で進める)

### 目的

inline 画像表示の CLS を 0 にするため、画像の実寸を upload 時に DB に保存する。

### 作業内容

- [ ] `apps/dm/serializers.py` `ConfirmAttachmentInputSerializer` に `width / height` (optional, min=1, max=20000)
- [ ] `apps/dm/services.py` `confirm_attachment(...)` 引数に width/height、`MessageAttachment.objects.create(width=..., height=...)`
- [ ] mime_type が image/\* でなければ width/height を None に強制 (整合)
- [ ] tests/test_services.py: image MIME で保存 / non-image で None / 不正値 (negative, >20000) 拒否
- [ ] tests/test_views.py: confirm POST で width/height が DB に反映

### 受け入れ基準

- [ ] 既存 confirm リクエスト (width/height なし) も 201 で動く (後方互換)
- [ ] image MIME で width/height 保存
- [ ] non-image MIME で width/height は None
- [ ] negative / >20000 で 400

---

## A3. [docs][dm] DM 添付表示の仕様 / インフラ env を docs 化

- **Labels**: `type:feature`, `layer:backend`, `area:dm`, `priority:low`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S
- **Depends-on**: A1

### 目的

新 env / 新 serializer field の運用ドキュメント化。

### 作業内容

- [ ] `docs/SPEC.md` §6 (DM) に MVP / a11y / lightbox 要件を追記
- [ ] `docs/operations/infrastructure.md` (新規 or 既存追記) に `DM_ATTACHMENT_BASE_URL` の env 切替表

### 受け入れ基準

- [ ] レビューで spec / docs に齟齬なし

---

## B1. [feature][dm] 画像寸法計測 util + uploader が confirm に width/height を渡す

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M
- **Depends-on**: A2

### 目的

upload 時 client で画像寸法を測り、confirm payload に乗せる。

### 作業内容

- [ ] `client/src/lib/dm/imageDimensions.ts` 新規: `measureImageDimensions(file, timeoutMs=5000)`
- [ ] `client/src/lib/dm/attachments.ts`: `confirmAttachment` 引数に `width? height?` を追加、`uploadAttachment` 内で image なら計測してから confirm に渡す
- [ ] vitest: jpeg/png 計測 / 壊れた image で null / non-image で null / Object URL revoke 検証

### 受け入れ基準

- [ ] image upload 時の confirm payload に width/height が含まれる
- [ ] non-image / 計測失敗で send は continue (block しない)
- [ ] Object URL leak しない (revoke される)

---

## B2. [feature][dm] AttachmentImageGrid + FileChip + MessageBubble 統合

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: L
- **Depends-on**: A1

### 目的

メッセージ bubble 内の添付を画像 inline / ファイル chip で正しく表示。

### 作業内容

- [ ] `client/src/components/dm/AttachmentImageGrid.tsx` 新規 (1〜5+ 枚配置)
- [ ] `client/src/components/dm/AttachmentFileChip.tsx` 新規 (chip + ダウンロード)
- [ ] `client/src/lib/dm/attachmentDisplay.ts` 新規 (isImage / formatFileSize / iconForMime)
- [ ] `client/src/components/dm/MessageBubble.tsx` 修正: image / non-image で分岐
- [ ] vitest: grid 1〜5+ 枚の DOM 構造、size formatter、chip ダウンロード href

### 受け入れ基準

- [ ] 1/2/3/4 枚で正しい grid
- [ ] 5 枚以上で「+N」overlay
- [ ] non-image chip でダウンロード可能
- [ ] image alt = filename

---

## B3. [feature][dm] AttachmentLightbox (focus trap + keyboard nav)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:medium`
- **Milestone**: `Phase 3: DM`
- **Estimate**: L
- **Depends-on**: B2

### 目的

inline 画像クリックでフル解像度 lightbox を開く。a11y 完全対応。

### 作業内容

- [ ] `client/src/components/dm/AttachmentLightbox.tsx` (Radix Dialog ベース)
- [ ] `MessageBubble.tsx` の image click → lightbox open
- [ ] ESC / 外側 click / × で close
- [ ] 複数枚で ←→ ナビ + ヘッダー「N / M」表示
- [ ] focus trap、open 時に previous focus 記憶 → close で復帰
- [ ] `prefers-reduced-motion: reduce` 対応 (fade のみ)
- [ ] vitest RTL: ESC 閉じ / 外側 click 閉じ / Tab 循環 / ←→ index 移動

### 受け入れ基準

- [ ] キーボードのみで開閉 / ナビ / ダウンロード可能
- [ ] focus trap が抜けない
- [ ] 開く前の focus 元に戻る
- [ ] reduced-motion で animation 無効

---

## C1. [test][dm] Playwright UI E2E: setInputFiles で添付表示 / lightbox

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:high`
- **Milestone**: `Phase 3: DM`
- **Estimate**: M
- **Depends-on**: B2, B3

### 目的

PR #455 の反省 (API curl だけで pass を主張した) を踏まえ、UI を実際に踏む E2E を必須化する。

### 作業内容

- [ ] `client/e2e/fixtures/sample-image.png` (< 50KB) と `sample-doc.pdf` を repo にコミット
- [ ] `client/e2e/dm-attachment-display.spec.ts` 新規:
  - login → /messages/<id> → `setInputFiles(画像)` → 送信 → bubble 内 `<img>` visible → click → lightbox open → ESC で閉じる
  - 非画像も同様にファイル chip 表示確認
- [ ] `prefers-reduced-motion: reduce` で起動して animation 無効を確認

### 受け入れ基準

- [ ] Playwright pass (chromium、stg or local いずれかで)
- [ ] phase3.spec.ts の line 23 コメント (添付は手動 stg E2E に回す) を撤回 / 更新

---

## C2. [docs][dm] 添付表示 spec / scenarios / e2e-commands を起票 (= 本 PR)

- **Labels**: `type:feature`, `layer:frontend`, `area:dm`, `priority:low`
- **Milestone**: `Phase 3: DM`
- **Estimate**: S
- **Depends-on**: なし

### 目的

3 件の docs を新規追加。

### 作業内容

- [ ] docs/specs/dm-attachment-display-spec.md
- [ ] docs/specs/dm-attachment-display-scenarios.md
- [ ] docs/specs/dm-attachment-display-e2e-commands.md

### 受け入れ基準

- [ ] 各 doc 相互リンク済 + ROADMAP / SPEC §6 から参照可能
