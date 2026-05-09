# DM 添付メッセージ表示 (Teams 級 UX) — 詳細仕様

> Version: 0.1 (Phase 3 follow-up、2026-05-09)
> 関連: [SPEC.md §6](../SPEC.md), [dm-attachment-display-scenarios.md](./dm-attachment-display-scenarios.md), [dm-attachment-display-e2e-commands.md](./dm-attachment-display-e2e-commands.md)
>
> Phase 3 で添付フロー (presign → S3 → confirm → WS) 自体は完成し、PR #457 で UI 統合 (📎 ボタン) も完了済。本仕様は **送信後のメッセージ表示** を Teams / Slack 級まで引き上げるためのもの。

---

## 1. スコープ

### 1.1 MVP (本仕様の対象)

| #   | 機能                                 | 必須 | 補足                                                             |
| --- | ------------------------------------ | ---- | ---------------------------------------------------------------- |
| 1   | 画像 inline preview                  | ✅   | `<img>` 直描画 (`max-width:480px`, `width`/`height` 属性、CLS 0) |
| 2   | クリック → lightbox                  | ✅   | フル解像度モーダル、ESC / 外側 click / × / ←→                    |
| 3   | 非画像ファイル chip                  | ✅   | アイコン + filename + size + ダウンロード link                   |
| 4   | ダウンロード                         | ✅   | 画像も非画像も `<a download>`                                    |
| 5   | width / height 自動検出              | ✅   | upload 時 client で測 → confirm payload → DB 保存                |
| 6   | Attachment serializer に `url` field | ✅   | backend で CloudFront URL 組立、frontend からの URL 構築排除     |
| 7   | 複数画像グリッド                     | ✅   | 1=単独 / 2=横 / 3=右に2段 / 4=2x2 / 5+=2x2+「+N」                |
| 8   | a11y                                 | ✅   | `<img alt>`、`role=dialog aria-modal`、focus trap、ESC           |

### 1.2 スコープ外 (別 phase / 別 issue)

- メッセージへの reaction 絵文字
- メッセージ reply / thread
- メッセージ編集 (削除のみ既存)
- @mention with autocomplete
- markdown / コードブロックレンダラ
- link unfurling (OGP)
- 動画 inline / 音声プレビュー
- 同一 room 全体の画像をスワイプ (lightbox は同メッセージ内のみ)

---

## 2. データモデル / API

### 2.1 既存の MessageAttachment (apps/dm/models.py)

```python
class MessageAttachment(TimeStampedModel):
    message = ForeignKey(Message, null=True, related_name="attachments")
    uploaded_by = ForeignKey(User)
    s3_key = CharField(max_length=1024, unique=True)
    filename = CharField(max_length=255)
    mime_type = CharField(max_length=100)
    size = PositiveIntegerField()
    width = PositiveIntegerField(null=True, blank=True)   # ← 既存だが confirm 時未保存
    height = PositiveIntegerField(null=True, blank=True)  # ← 同上
```

→ migration 不要。confirm 時の payload に追加するのみ。

### 2.2 ConfirmAttachmentInputSerializer 拡張

```python
class ConfirmAttachmentInputSerializer(serializers.Serializer):
    room_id = serializers.IntegerField(min_value=1)
    s3_key = serializers.CharField(max_length=1024)
    filename = serializers.CharField(max_length=255)
    mime_type = serializers.CharField(max_length=100)
    size = serializers.IntegerField(min_value=1)
    # 追加 (本仕様)
    width = serializers.IntegerField(min_value=1, max_value=20000, required=False, allow_null=True)
    height = serializers.IntegerField(min_value=1, max_value=20000, required=False, allow_null=True)
```

`mime_type` が `image/*` でない場合、service 層で width/height を `None` に上書きする (整合性確保)。

### 2.3 MessageAttachmentSerializer 拡張

```python
class MessageAttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()  # 追加

    class Meta:
        model = MessageAttachment
        fields = ["id", "s3_key", "url", "filename", "mime_type", "size", "width", "height"]

    def get_url(self, obj: MessageAttachment) -> str:
        # settings.DM_ATTACHMENT_BASE_URL は app_fqdn (CloudFront /dm/* path-pattern と組み合わせ)
        from django.conf import settings
        base = settings.DM_ATTACHMENT_BASE_URL.rstrip("/")
        return f"{base}/{obj.s3_key}"
```

### 2.4 settings の追加 env

```python
# config/settings/base.py
DM_ATTACHMENT_BASE_URL = getenv("DM_ATTACHMENT_BASE_URL", "")

# 起動時 fail-fast (sec MEDIUM): 未設定なら ImproperlyConfigured を raise
if not DM_ATTACHMENT_BASE_URL:
    raise ImproperlyConfigured(
        "DM_ATTACHMENT_BASE_URL is required. Set to e.g. 'https://stg.codeplace.me' "
        "(CloudFront /dm/* behavior は既存の S3 media origin に振っている)."
    )
```

env 一覧:

- `local` (.env.local): `DM_ATTACHMENT_BASE_URL=http://localhost:8080`
- `stg` (terraform): `DM_ATTACHMENT_BASE_URL=https://stg.codeplace.me`
- `prod` (terraform): `DM_ATTACHMENT_BASE_URL=https://<prod_domain>`

---

## 3. UI 仕様

### 3.1 MessageBubble の表示分岐

```
attachments[]
├─ image MIME (image/*) → AttachmentImageGrid に渡す
└─ それ以外 → AttachmentFileChip × N で縦に並べる
```

`body` と attachments は両立 (本文ありで画像 1 枚 = body 上 / image 下、本文なしで画像のみ = image のみ)。

### 3.2 AttachmentImageGrid

枚数別の grid 配置 (Teams / Slack を参考):

| 枚数 | 配置                                  | CSS                                     |
| ---- | ------------------------------------- | --------------------------------------- |
| 1    | 単独 (max-width:480px、aspect 維持)   | flex                                    |
| 2    | 横並び 1x2                            | grid-cols-2 gap-1                       |
| 3    | 左 1 大 / 右 2 縦                     | grid-cols-2 grid-rows-2 + 左 row-span-2 |
| 4    | 2x2                                   | grid-cols-2 gap-1                       |
| 5+   | 2x2 + 4 マス目右下に「+(N-3)」overlay | 4 マス目 absolute overlay               |

各 `<img>`:

```html
<img
	src="{att.url}"
	alt="{att.filename}"
	width="{att.width}"
	height="{att.height}"
	loading="lazy"
	decoding="async"
	class="block w-full h-full object-cover rounded cursor-zoom-in"
	onClick="{() => openLightbox(att.id)}"
/>
```

`width`/`height` が null の場合は `max-height:360px`、`object-fit:contain` フォールバック。

### 3.3 AttachmentFileChip

```
[📄] filename.pdf  120.3 KB  [⬇️ ダウンロード]
```

- アイコンは MIME 別: `application/pdf` → 📄、`text/*` → 📝、`application/zip` → 🗜️、その他 → 📎
- `<a href={att.url} download={att.filename}>` で OS ダウンロードダイアログ
- a11y: `<a aria-label="ダウンロード: filename.pdf (120.3 KB)">`

### 3.4 AttachmentLightbox

- portal で `<dialog>` 同等 (Radix `Dialog.Root` を使う、既存依存)
- `role="dialog"` `aria-modal="true"` `aria-labelledby="lightbox-filename"`
- 背景は半透明 (rgba(0,0,0,0.85))
- 中央に `<img>` を `object-fit:contain` で配置
- ヘッダー: filename + size (上)
- フッター: ダウンロードボタン + ページ送り (1/3、複数のみ)
- キーボード:
  - `ESC` → close
  - `←` / `→` → prev / next (複数のみ)
  - `Tab` → focus trap (Radix Dialog 標準)
- 開いたとき:
  - 直前 focus を memorize → close で復帰
  - 最初の close button or img に focus
- `prefers-reduced-motion: reduce` の場合はアニメーション無効 (fade のみ)

### 3.5 a11y 詳細

- 画像: `<img alt={filename}>` (空 alt は使わない、必ず filename を入れる)
- ファイル chip: `<a aria-label="ダウンロード: {filename} ({size})">`
- Lightbox 開閉時: `role="status"` で「{filename} を全画面表示しています」を 1 回告知
- グリッド「+N」overlay: `aria-label="あと N 枚の画像、クリックで全表示"`
- キーボードでも grid の各画像に Tab で到達可、Enter / Space で lightbox 起動

---

## 4. アップロード時の寸法計測

### 4.1 client/src/lib/dm/imageDimensions.ts

```typescript
export async function measureImageDimensions(
	file: File,
	timeoutMs = 5000,
): Promise<{ width: number; height: number } | null> {
	if (!file.type.startsWith("image/")) return null;
	return new Promise((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		const timer = setTimeout(() => {
			URL.revokeObjectURL(url);
			resolve(null);
		}, timeoutMs);
		img.onload = () => {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
			resolve({ width: img.naturalWidth, height: img.naturalHeight });
		};
		img.onerror = () => {
			clearTimeout(timer);
			URL.revokeObjectURL(url);
			resolve(null); // 計測失敗は send をブロックしない
		};
		img.src = url;
	});
}
```

### 4.2 uploadAttachment 連携

```typescript
async function uploadAttachment({ roomId, file, onProgress }) {
	const dimensions = await measureImageDimensions(file); // null なら non-image または失敗
	// presign → S3 PUT → confirm
	return confirmAttachment({
		room_id: roomId,
		s3_key,
		filename: file.name,
		mime_type: file.type,
		size: file.size,
		width: dimensions?.width,
		height: dimensions?.height,
	});
}
```

---

## 5. パフォーマンス

- `<img loading="lazy">` で off-screen 画像は遅延読み込み
- `<img decoding="async">` で main thread をブロックしない
- `width`/`height` 属性で aspect-ratio 確保 → CLS = 0
- lightbox 開閉時のみ full-resolution を fetch (preload しない)
- 5 枚超の grid は最初の 4 枚のみ render、それ以降は lightbox で見る

---

## 6. セキュリティ

- `<img src>` は backend が組み立てた CloudFront URL のみ (frontend からの URL 構築禁止)
- `<a download>` の filename は backend から来た値をそのまま使う (XSS 経路なし、属性値)
- SVG ファイルは MVP では非対応 (XSS リスク)。MIME `image/svg+xml` は presign で reject (Phase 3 既存制限)
- lightbox は同一 origin の URL のみ表示 (CSP `img-src` で stg/prod ドメインに制限)

---

## 7. 受け入れ基準

- [ ] backend serializer に `url` field、`s3_key` + base_url の連結が正しい
- [ ] confirm 時 image MIME で width/height が DB に保存される
- [ ] confirm 時 non-image MIME で width/height が None
- [ ] frontend AttachmentImageGrid の 1〜5+ 枚配置がデザイン通り
- [ ] lightbox: ESC / 外側 click / × で close、複数で ←→ ナビ、focus trap
- [ ] non-image はファイル chip でダウンロード可能
- [ ] Playwright UI E2E (`setInputFiles`) で添付送信 → 表示 → lightbox 開閉まで pass
- [ ] 既存テスト全 pass (回帰なし)

---

## 8. 関連 Issue (本 phase で起票)

- A1: `[feature][dm] MessageAttachment serializer に url field を追加`
- A2: `[feature][dm] confirm_attachment で width/height を保存`
- A3: `[docs][dm] DM 添付表示の仕様 / インフラ env を docs 化`
- B1: `[feature][dm] 画像寸法計測 util + uploader が confirm に width/height を渡す`
- B2: `[feature][dm] AttachmentImageGrid + FileChip + MessageBubble 統合`
- B3: `[feature][dm] AttachmentLightbox (focus trap + keyboard nav)`
- C1: `[test][dm] Playwright UI E2E: setInputFiles で添付表示 / lightbox`
- C2: `[docs][dm] 添付表示 spec / scenarios / e2e-commands を起票` (= この PR 自身)
