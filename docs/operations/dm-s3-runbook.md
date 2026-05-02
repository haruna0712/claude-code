# DM 添付の S3 運用 Runbook (P3-07)

> **対応 Issue**: #232
> **対象モジュール**: `terraform/modules/storage/`、`terraform/environments/stg/main.tf` > **関連 SPEC**: [docs/SPEC.md](../SPEC.md) §7 (DM 添付ファイル)
>
> Phase 3 で導入した DM 添付ファイル機能の S3 周りの設定・運用方法をまとめる。

---

## 1. 全体像

DM 添付は media バケット (`sns-stg-media` / `sns-prod-media`) 内の **`dm/` prefix** に格納する。

```
sns-stg-media/
├── avatars/      ← Phase 1 (ユーザーアバター)
├── tweets/       ← Phase 2 (ツイート画像)
├── articles/     ← Phase 4 (記事添付、未実装)
└── dm/           ← Phase 3 (DM 添付、本 runbook の対象)
    └── <year>/<month>/<day>/<message_id>/<filename>
```

`dm/` prefix だけ別ライフサイクル & 別 IAM 権限を当て、それ以外の prefix は影響を受けない。

---

## 2. ライフサイクル (storage モジュール)

| 経過日数 | アクション            | 目的                                      |
| -------- | --------------------- | ----------------------------------------- |
| 90 日    | `GLACIER_IR` へ移行   | 取り出し即時で安価 (S3 Standard の約 1/4) |
| 365 日   | 削除 (expiration)     | プライバシー + コスト                     |
| 30 日    | 旧バージョンも削除    | バージョニング暴発防止                    |
| 1 日     | 不完全 multipart 削除 | upload abort 後のゴミ回収                 |

> 既存の `cleanup-noncurrent-versions` ルール (filter なし、全 prefix) は `dm/`
> オブジェクトの noncurrent version にもマッチするが、dm 専用ルールの 30 日が
> 先に発動するため実効は 30 日 (storage/main.tf のコメント参照)。

stg では `terraform/environments/stg/variables.tf` の `dm_attachment_glacier_ir_days` /
`dm_attachment_expiration_days` を `terraform.tfvars` で上書きできる:

```hcl
# terraform/environments/stg/terraform.tfvars
dm_attachment_glacier_ir_days = 60
dm_attachment_expiration_days = 730
```

> **制約**: `dm_attachment_expiration_days` は `dm_attachment_glacier_ir_days` より大きい値
> (または 0 で無期限) を指定。違反すると `terraform plan` の precondition で fail する
> (apply 前に検出される)。
>
> **注意**: `dm_attachment_expiration_days = 0` は「永続保持」を意味する。法務的に問題ない場合のみ。

---

## 3. IAM 権限 (stg レイヤで wiring)

`storage` 単体では `dm/*` 権限を発行しない。`storage` ↔ `compute` の循環参照を避けるため、
`terraform/environments/stg/main.tf` で `aws_iam_role_policy.ecs_dm_attachment` として
両モジュール作成後に attach する。

権限内訳 (実 ARN は `terraform output media_bucket_arn` で確認):

| Action                 | Resource scope     | 条件                        | 用途                              |
| ---------------------- | ------------------ | --------------------------- | --------------------------------- |
| `s3:PutObject`         | `<media_arn>/dm/*` | —                           | presigned URL 発行 (P3-06)        |
| `s3:GetObject`         | `<media_arn>/dm/*` | —                           | 添付ダウンロード (HEAD/Range)     |
| `s3:GetObjectVersion`  | `<media_arn>/dm/*` | —                           | versioning ON で 404 誤判定回避   |
| `s3:DeleteObject`      | `<media_arn>/dm/*` | —                           | メッセージ削除時 (SPEC §7.3、24h) |
| `s3:ListBucket`        | `<media_arn>`      | `s3:prefix StringLike dm/*` | Glacier IR 復元時の存在確認       |
| `s3:GetBucketLocation` | `<media_arn>`      | —                           | SDK のリージョン解決              |

avatars / tweets / articles など他 prefix には触らないことが保証される
(オブジェクトレベル権限は `dm/*` 限定、ListBucket は `s3:prefix` 条件で絞り込み)。

---

## 4. CORS (presigned PUT/POST)

`var.frontend_origins` で渡した origin だけ presigned URL の PUT/POST を許可する。
ワイルドカードは validation で禁止 ([s3-presigned-upload.md](./s3-presigned-upload.md) 参照)。

```hcl
# terraform/environments/stg/main.tf
module "storage" {
  frontend_origins = ["https://stg.example.com"]
}
```

---

## 5. 暗号化

- バケットレベルで SSE-S3 (AES256) がデフォルト ON。bucket key も有効。
- アプリ側で `x-amz-server-side-encryption` ヘッダ付与は **不要** (バケットデフォルトで encrypt される)。
- 強制 deny policy は導入していない (default 暗号化 + IAM block public で十分)。
  万一マルウェアスキャンや KMS 監査要件が出てきたら、別途 `aws_s3_bucket_policy` で `Deny`
  ステートメントを足す方針。

---

## 6. 退会・大量削除の運用

- ユーザーが退会した場合の DM object 一括削除は **Phase 9 で scheduled task として実装予定** (現状未実装)。

### 6.1 削除前の preflight (必須)

prod / stg どちらに対する操作か必ず先に確認する:

```bash
aws sts get-caller-identity
# → "Account": "<id>" を確認。stg と prod で AWS account が異なるはず。
aws s3 ls s3://sns-stg-media/dm/ | head -20
# → 想定どおりのバケットを参照しているか確認。
```

### 6.2 個別 object の削除

```bash
# まず --dryrun で対象を確認
aws s3 rm "s3://sns-stg-media/dm/2026/05/01/<message_id>/" --recursive --dryrun
# 出力を目視確認後、--dryrun を外して実行
aws s3 rm "s3://sns-stg-media/dm/2026/05/01/<message_id>/" --recursive
```

### 6.3 stg 環境の dm/ 完全リセット (テスト用途のみ)

```bash
# Step 1: --dryrun で件数確認
aws s3 rm "s3://sns-stg-media/dm/" --recursive --dryrun | wc -l

# Step 2: current version 削除 (delete marker が残るだけで実体は復元可能)
aws s3 rm "s3://sns-stg-media/dm/" --recursive

# Step 3: バージョニング ON のバケットでは current 削除だけでは実体が残る。
#         全 version + delete marker を削除するには delete-objects API を使う:
aws s3api list-object-versions \
  --bucket sns-stg-media --prefix "dm/" \
  --query '{Objects: [Versions, DeleteMarkers][].{Key:Key, VersionId:VersionId}}' \
  --output json > /tmp/dm-versions.json
aws s3api delete-objects --bucket sns-stg-media --delete file:///tmp/dm-versions.json
```

> **本番では絶対に実行しない**。退会フローは別途 Phase 9 で承認・監査ログ込みで実装する。
> 上記コマンドはプロビジョニング後の **stg 環境のテスト用途** に限定する。

---

## 7. 関連: Phase 3 で未実装の運用タスク

| 項目                                | 受け持つ Phase | 備考                                             |
| ----------------------------------- | -------------- | ------------------------------------------------ |
| ウイルススキャン (S3 Object Lambda) | Phase 6+       | 添付確定 → ClamAV → 安全タグ付け                 |
| 退会時の bulk delete                | Phase 9        | RDS user soft-delete → Celery beat で 24h 後実行 |
| 法的開示要請対応                    | Phase 10       | versioning が ON なので 30 日以内なら復元可      |

---

## 8. apply 手順

```bash
# Step 0: 操作対象アカウントを確認 (stg / prod 取り違え防止)
aws sts get-caller-identity

# Step 1: フォーマット & 検証
cd terraform/environments/stg
terraform fmt
terraform validate

# Step 2: plan
terraform plan -out=dm-s3.plan

# Step 3: 差分確認後、ハルナさん手動で:
terraform apply dm-s3.plan
```

> CLAUDE.md §9 の通り、`terraform apply` は人間が必ず実行する。Claude は plan までで止まる。
> apply 直前に `aws sts get-caller-identity` でアカウント ID を確認することを必ず行う
> (security-reviewer HIGH-2: prod / stg バケット名が 4 文字差のため誤操作リスク高)。
