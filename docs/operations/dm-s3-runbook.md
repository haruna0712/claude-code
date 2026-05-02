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

変更したい場合は `terraform/environments/stg/terraform.tfvars` で:

```hcl
# storage モジュールに渡す変数 (terraform/modules/storage/variables.tf)
# dm_attachment_glacier_ir_days = 60
# dm_attachment_expiration_days = 730
```

> **注意**: `dm_attachment_expiration_days = 0` は「永続保持」を意味する。法務的に問題ない場合のみ。

---

## 3. IAM 権限 (stg レイヤで wiring)

`storage` 単体では `dm/*` 権限を発行しない。`storage` ↔ `compute` の循環参照を避けるため、
`terraform/environments/stg/main.tf` で `aws_iam_role_policy.ecs_dm_attachment` として
両モジュール作成後に attach する。

権限内訳:

| Action                 | Resource                          | 用途                                 |
| ---------------------- | --------------------------------- | ------------------------------------ |
| `s3:PutObject`         | `arn:aws:s3:::sns-stg-media/dm/*` | presigned URL 発行 (P3-06)           |
| `s3:GetObject`         | `arn:aws:s3:::sns-stg-media/dm/*` | 添付ダウンロード (HEAD/Range)        |
| `s3:DeleteObject`      | `arn:aws:s3:::sns-stg-media/dm/*` | メッセージ削除時の object 削除 (24h) |
| `s3:GetBucketLocation` | `arn:aws:s3:::sns-stg-media`      | multipart upload 状態確認            |

avatars / tweets / articles など他 prefix には触らないことが保証される (resource path で `dm/*` 限定)。

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
- 緊急で個別 object を削除する場合は AWS CLI:

```bash
aws s3 rm "s3://sns-stg-media/dm/2026/05/01/<message_id>/" --recursive
```

- バケット全体に `dm/` だけ完全削除したい場合 (テスト環境のリセット):

```bash
aws s3 rm "s3://sns-stg-media/dm/" --recursive
```

> **本番では絶対に実行しない**。退会フローは別途 Phase 9 で承認・監査ログ込みで実装する。

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
cd terraform/environments/stg
terraform fmt
terraform validate
terraform plan -out=dm-s3.plan
# → 差分確認後、ハルナさん手動で:
terraform apply dm-s3.plan
```

> CLAUDE.md §9 の通り、`terraform apply` は人間が必ず実行する。Claude は plan までで止まる。
