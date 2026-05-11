# 記事内画像アップロード spec (P6-04 / Issue #527)

> Phase 6 P6-04 backend のみ。 frontend D&D 連携は別 PR (P6-13 follow-up)。
>
> 関連:
>
> - [docs/issues/phase-6.md](../issues/phase-6.md) P6-04
> - [docs/SPEC.md](../SPEC.md) §12 (記事)、§7.3 (DM attachment、 流用元)
> - [apps/dm/s3_presign.py](../../apps/dm/s3_presign.py) (presigned POST + head_object 再検証パターン、 そのまま踏襲)
> - [apps/dm/services.py](../../apps/dm/services.py) `confirm_attachment` (確定フローの参考)
> - chatapp 参考: `app/posts/views.py` の `media` action は **multipart 直アップロード方式** で本リポジトリの方針と異なるため API 形式は流用しない (流儀のみ参考にした)。

## 1. 背景・目的

`ArticleImage` モデル ([apps/articles/models.py:166-202](../../apps/articles/models.py)) は P6-01 で既に作成済 (`article=null` 可、 `s3_key` unique、 width/height/size 必須)。 しかし「画像を S3 にアップロードするための endpoint」 が無いため、 記事本文に画像を貼ることができない。

P6-04 では DM 添付と同じ **presigned POST + confirm 二段階方式** で `ArticleImage` を作成する 2 つの API を追加する。 frontend の D&D 実装 (P6-13 follow-up) はこの API を消費する。

### なぜ presigned POST + confirm の二段階か

| 方式                                                    | 長所                                                                                                                              | 短所                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| multipart 直アップロード (chatapp / Django デフォルト)  | シンプル、 1 リクエスト                                                                                                           | サーバ帯域・CPU を画像で食う、 ECS task の memory pressure、 大量並列で死ぬ |
| presigned PUT + 単発                                    | サーバ非経由、 中庸                                                                                                               | クライアントが任意の Content-Type で PUT 可能 (MIME 偽装余地)               |
| **presigned POST + Conditions + confirm 再検証** (採用) | サーバ非経由、 S3 側で `content-length-range` / `eq Content-Type` / `eq key` を強制、 confirm で `head_object` 再検証で改ざん検出 | 2 リクエスト必要 (frontend は state machine 増える)                         |

DM 添付で security-reviewer の指摘 (HIGH H-1/H-2/H-3) を反映して採用した形式と同じ。 新しい流儀を導入せず、 既存パターンを使う。

## 2. やる / やらない

### やる (PR A スコープ)

- `apps/articles/s3_presign.py` 新設: `validate_image_request` / `build_s3_key` / `generate_presigned_image_upload` / `head_object` / `public_url_for` を `apps/dm/s3_presign.py` から **必要分のみ port**。
- `POST /api/v1/articles/images/presign/` endpoint 追加 (auth、 throttle、 serializer 入力検証)。
- `POST /api/v1/articles/images/confirm/` endpoint 追加 (auth、 throttle、 head_object 再検証、 `ArticleImage` orphan 作成、 serializer 出力)。
- `apps/articles/services/images.py` 新設: `confirm_image` 関数で「`head_object` 再検証 → `ArticleImage.objects.create(article=None, uploader=user, ...)` → DTO 返却」 を担う。
- throttle scope 追加 (`article_image_presign: 30/hour` + `article_image_confirm: 30/hour`、 stg は 300/hour)。
- pytest: 8 ケース (presign 成功 / size 超過 / MIME 不許可 / 認証必須 + confirm 成功 / size 不一致 / Content-Type 不一致 / object 不在 / 認証必須)。
- カバレッジ 80%+ を `apps/articles/s3_presign.py` と `apps/articles/services/images.py` で達成。
- admin に `ArticleImage` を登録 (orphan 監査用)。 既に登録済みなら no-op。

### やらない (このスコープ外、 別 PR / 別 Issue へ)

- frontend ArticleEditor の D&D / paste 連携 (PR C / P6-13 follow-up)。
- 画像と `Article` の自動 binding (本文 markdown 内の URL を scan して `ArticleImage.article` を埋める)。 P6-09 (GitHub push) と連動するため別 Issue で再検討。
- orphan `ArticleImage` (article=NULL のまま 24 時間以上) の GC Celery beat。 S3 lifecycle rule (既存 365 日自動削除) で当面しのぐ。 別 Issue で起票。
- 動画 (video/\*) や任意 file 形式の添付。 SPEC §12 は image のみ。

## 3. API 仕様

### 3.1 `POST /api/v1/articles/images/presign/`

S3 presigned POST URL を発行する。

#### 認可

- `IsAuthenticated` 必須 (匿名は 401)。
- throttle `article_image_presign: 30/hour` (stg `300/hour`)。 30/hour は記事 1 本に画像 10 枚貼っても 3 本/時 = 通常運用十分。

#### Request body

```json
{
	"filename": "screenshot.png",
	"mime_type": "image/png",
	"size": 245678
}
```

| field       | 型     | 制約                                                                                                                             |
| ----------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `filename`  | string | 1〜200 文字、 制御文字 / NUL / `/` / `\` / `..` を含まない、 拡張子が `mime_type` と一致 (`image/jpeg` は `jpg` `jpeg` 両方許容) |
| `mime_type` | string | `image/jpeg` / `image/png` / `image/webp` / `image/gif` の 4 種のみ                                                              |
| `size`      | int    | 1〜5_242_880 (5 MiB)                                                                                                             |

#### Response (200)

```json
{
  "url": "https://<bucket>.s3.<region>.amazonaws.com/",
  "fields": {
    "key": "articles/<user_uuid>/<image_uuid>.png",
    "Content-Type": "image/png",
    "policy": "...",
    "x-amz-signature": "...",
    ...
  },
  "s3_key": "articles/<user_uuid>/<image_uuid>.png",
  "expires_at": "2026-05-11T12:34:56+00:00"
}
```

- `s3_key` は `articles/<user_uuid>/<image_uuid>.<ext>` 形式。
  - `<user_uuid>` は `request.user.id` を 16 進そのまま (path-traversal 安全)。
  - `<image_uuid>` は `uuid4()` を新規発行 (collision 確率は実質ゼロ)。
  - 拡張子は MIME map から決定 (`image/jpeg` → `jpg` 固定)。
- `expires_at` は ISO8601 UTC、 5 分後。

#### Response (400)

`{"detail": "..."}` または `{"field_name": ["..."]}` で標準的な DRF エラー形式。

#### S3 側強制 (Conditions)

`generate_presigned_post` の `Conditions` で:

```python
[
  ["content-length-range", 1, 5_242_880],
  {"Content-Type": "image/png"},   # 申告と完全一致
  {"key": "articles/<user_uuid>/<image_uuid>.png"},  # 別 key への流用禁止
]
```

→ frontend が PUT 時にサイズや MIME を書き換えても S3 側で 403 で reject。

### 3.2 `POST /api/v1/articles/images/confirm/`

S3 への PUT 完了後、 `ArticleImage` orphan を作成する。

#### 認可

- `IsAuthenticated` 必須。
- throttle `article_image_confirm: 30/hour` (stg `300/hour`)。
- s3_key の prefix `articles/<request.user.id>/` を強制 (他ユーザーの key を confirm されないように)。

#### Request body

```json
{
	"s3_key": "articles/<user_uuid>/<image_uuid>.png",
	"filename": "screenshot.png",
	"mime_type": "image/png",
	"size": 245678,
	"width": 1024,
	"height": 768
}
```

| field       | 型     | 制約                                                                                            |
| ----------- | ------ | ----------------------------------------------------------------------------------------------- |
| `s3_key`    | string | `articles/<request.user.id>/` で始まる、 `posixpath.normpath` で `..` collapse 後も prefix 一致 |
| `filename`  | string | 3.1 と同条件                                                                                    |
| `mime_type` | string | 3.1 と同条件                                                                                    |
| `size`      | int    | 3.1 と同条件、 かつ `head_object` の `ContentLength` と完全一致                                 |
| `width`     | int    | 1〜10000 (frontend は `naturalWidth` から取得)                                                  |
| `height`    | int    | 1〜10000                                                                                        |

#### Response (201)

```json
{
	"id": "<image_uuid>",
	"s3_key": "articles/<user_uuid>/<image_uuid>.png",
	"url": "https://cdn.example.com/articles/<user_uuid>/<image_uuid>.png",
	"width": 1024,
	"height": 768,
	"size": 245678,
	"created_at": "2026-05-11T12:34:56+00:00"
}
```

`url` は `AWS_S3_CUSTOM_DOMAIN` (CloudFront) があればそれ経由、 なければ S3 virtual host (`https://<bucket>.s3.<region>.amazonaws.com/<key>`)。 既存 `apps.dm.s3_presign.public_url_for` と同方針。

#### Response (400)

| エラー                                               | trigger                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `s3_key must start with 'articles/<your_uuid>/'`     | 他ユーザーの key を confirm しようとした |
| `S3 上のサイズ (X) が申告 (Y) と一致しません`        | 改ざんで PUT した                        |
| `S3 上の Content-Type (X) が申告 (Y) と一致しません` | MIME 偽装                                |
| `object not found: <s3_key>`                         | PUT が未完了、 または key 流用           |
| `width / height は 1..10000`                         | 範囲外                                   |

## 4. データ層

### 4.1 既存 `ArticleImage` モデル (no change)

[apps/articles/models.py:166](../../apps/articles/models.py) で既に定義済:

- `article: FK Article, null=True, blank=True` ← orphan 許容
- `uploader: FK User, on_delete=CASCADE`
- `s3_key: CharField(unique=True, max=512)`
- `url: URLField(max=1024)`
- `width / height / size: PositiveIntegerField`
- `created_at: DateTimeField(auto_now_add)`

migration 追加は不要 (既に 0001_initial に含まれている)。

### 4.2 admin

[apps/articles/admin.py](../../apps/articles/admin.py) で既に登録済かを確認。 未登録なら `@admin.register(ArticleImage)` を追加。 list_display は `id` `uploader` `article` `s3_key` `size` `created_at` 程度で十分。

## 5. テスト (TDD)

`apps/articles/tests/test_image_upload.py` に pytest を 8 ケース書く (Red 確認 → 実装で Green)。

| #   | テスト名                                  | 検証内容                                                                                                          |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| T1  | `test_presign_success`                    | auth user が valid request → 200 + url/fields/s3_key/expires_at が返る、 s3_key が `articles/<user_id>/` で始まる |
| T2  | `test_presign_rejects_oversized`          | size=5MB+1 → 400                                                                                                  |
| T3  | `test_presign_rejects_unsupported_mime`   | mime_type=`application/pdf` → 400                                                                                 |
| T4  | `test_presign_requires_auth`              | 匿名 → 401                                                                                                        |
| T5  | `test_confirm_success`                    | `head_object` mock で metadata 一致 → 201 + ArticleImage row 作成 (article=None、 uploader=user)                  |
| T6  | `test_confirm_rejects_size_mismatch`      | head_object の ContentLength が申告と不一致 → 400、 row 作成されない                                              |
| T7  | `test_confirm_rejects_foreign_key_prefix` | 他ユーザーの uuid から始まる s3_key → 400、 row 作成されない                                                      |
| T8  | `test_confirm_requires_auth`              | 匿名 → 401                                                                                                        |

`boto3.client` は `apps.articles.s3_presign.boto3.client` を `unittest.mock.patch` する (DM テストと同パターン)。 `head_object` は MagicMock の返り値で `ContentLength` / `ContentType` を制御。

カバレッジ目標:

- `apps/articles/s3_presign.py`: 90%+ (例外パスも touch)
- `apps/articles/services/images.py`: 85%+

## 6. ファイル変更まとめ

```
apps/articles/
  s3_presign.py          [新規 ~150 行]  DM の s3_presign.py から image 用に port
  services/
    images.py            [新規 ~80 行]   confirm_image() で head_object + create
  serializers.py         [既存 +40 行]   PresignImageInput / ConfirmImageInput / ImageConfirmResponse
  views.py               [既存 +60 行]   PresignArticleImageView + ConfirmArticleImageView
  urls.py                [既存 +2 行]    images/presign/ + images/confirm/
  admin.py               [既存 +10 行]   ArticleImage 登録 (未登録なら)
  tests/
    test_image_upload.py [新規 ~250 行] T1-T8

config/settings/base.py  [既存 +4 行]    article_image_presign / article_image_confirm scope

docs/specs/
  article-image-upload-spec.md  [新規、 本ファイル]
```

合計概算 ≈ 600 行 (テスト除いて ≈ 350 行)。 small PR ルール (500 行以下) を 1 PR 内で守れる。

## 7. 後続 PR への申し送り

- **PR B (P6-12 follow-up)**: 詳細ページに「編集」 button + `/articles/me/drafts` 画面。 API は既存 `listMyDrafts`。
- **PR C (P6-13 follow-up)**: ArticleEditor の live Markdown preview (`marked` + 既存 `isomorphic-dompurify`) + 画像 D&D。 本 spec の API (`/articles/images/presign/` + `/confirm/`) を消費し、 success 時に `![](url)` を caret 位置に挿入。 `gan-evaluator` agent を呼んで実機 UX を採点。
- **後追い Issue**: orphan `ArticleImage` (article=NULL かつ 24h 経過) の GC Celery beat。 S3 lifecycle (365 日) で当面回避。
