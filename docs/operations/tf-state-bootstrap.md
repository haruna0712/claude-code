# Terraform state backend bootstrap

Terraform state 保存用の AWS リソース (S3 バケット + DynamoDB lock テーブル) を
**Terraform 以外の手段** で 1 回だけ作成する手順。

state を保存するためのリソースを Terraform で管理してしまうと、
「state がまだ無い時点で state を作る」 chicken-and-egg が発生するため、
この 2 リソースだけはスクリプトで bootstrap する。

## 対象リソース

| リソース | 名前 (既定) | 用途 |
|---|---|---|
| S3 bucket | `sns-stg-tf-state` | terraform state file の保存先 |
| DynamoDB table | `sns-stg-tf-lock` | terraform apply の排他ロック |

両リソースとも:
- リージョン: `ap-northeast-1`
- 暗号化: SSE-S3 (bucket) / PAY_PER_REQUEST (table)
- Public Access: 完全遮断
- バージョニング有効 (bucket)

## 前提

- AWS アカウント (ハルナさんが管理)
- `aws` CLI v2 インストール済み
- `aws sso login` もしくは `aws configure` で管理権限のクレデンシャルを取得済み

## 手順

### 1. リポジトリ直下で実行

```bash
./scripts/bootstrap-tf-state.sh
```

引数で bucket 名・table 名・region を上書き可能:

```bash
./scripts/bootstrap-tf-state.sh \
  --region ap-northeast-1 \
  --bucket sns-stg-tf-state \
  --table  sns-stg-tf-lock
```

### 2. 冪等性

スクリプトは既に存在する場合スキップする。バージョニング・暗号化・Public Access Block
は毎回 apply するため、設定ドリフトは自動修復される。

### 3. 作成確認

```bash
aws s3api head-bucket --bucket sns-stg-tf-state
aws dynamodb describe-table --table-name sns-stg-tf-lock --query 'Table.TableStatus'
```

## トラブルシューティング

| 症状 | 原因 | 対応 |
|---|---|---|
| `InvalidBucketName` | bucket 名が既に世界中で使用中 | `--bucket <your-prefix>-tf-state` で unique な名前を指定 |
| `AccessDenied` | IAM 権限不足 | S3:CreateBucket / DynamoDB:CreateTable / sts:GetCallerIdentity を確認 |
| `BucketAlreadyOwnedByYou` | 既に同じアカウントで作成済み | 正常。スクリプトは続行して設定を更新する |

## 今後の拡張

- prod 環境では別バケット `sns-prod-tf-state` を推奨 (環境分離・権限境界)
- KMS カスタム CMK での暗号化に移行する場合、既存 state の再暗号化が必要

## 削除

stg 環境を破棄する際は state file が含まれる S3 バケットも明示的に削除する:

```bash
# state バケット内の全オブジェクト (全バージョン含む) を削除
aws s3api delete-objects --bucket sns-stg-tf-state ...
# バケット削除
aws s3api delete-bucket --bucket sns-stg-tf-state
# lock テーブル削除
aws dynamodb delete-table --table-name sns-stg-tf-lock
```

**警告**: 消すと `terraform destroy` 前の state も消えるため、順序に注意。
