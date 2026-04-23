# stg environment

Phase 0.5 で立ち上げる staging 環境。全 7 モジュールを結合する。

## 前提

1. `scripts/bootstrap-tf-state.sh` を実行済み
   (S3 bucket `sns-stg-tf-state` + DynamoDB `sns-stg-tf-lock` 作成済)
2. apex ドメインを取得済み (お名前.com 等)
3. AWS CLI / Terraform 1.9+ / 適切な IAM 権限

## 初期化 & Apply

```bash
cd terraform/environments/stg
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集して domain_name / alert_email を設定

terraform init
terraform plan
terraform apply
```

## 二段階 apply (chicken-and-egg 回避)

このディレクトリは以下の循環依存を抱えている:

- `storage` bucket policy には `edge` の OAC ARN が必要
- `compute` HTTPS listener には `edge` の ACM ARN が必要

初回 apply はこの 2 点を**空文字列**にして通す (main.tf の `cloudfront_oac_arn = ""`、
`alb_certificate_arn = ""`)。apply 後、以下の手順で埋める:

1. edge モジュール apply 完了後、`terraform output -raw route53_name_servers` で NS を取得
2. お名前.com で NS レコードを変更 ([docs/operations/dns-delegation.md](../../../docs/operations/dns-delegation.md) 参照)
3. NS 伝播を待ち (15 分〜数時間)、ACM 証明書が `ISSUED` になることを確認
4. **main.tf を編集**: `module.storage.cloudfront_oac_arn = module.edge.cloudfront_distribution_arn`、
   `module.compute.alb_certificate_arn = module.edge.acm_alb_arn`
5. 2 度目の `terraform apply`

**Phase 0.5-07 時点では初回 apply の成功までがスコープ**。二段階目の手順書は
[docs/operations/stg-deployment.md](../../../docs/operations/stg-deployment.md) (P0.5-16) で整備。

## リソース一覧 (概算)

| モジュール | 主要リソース |
|---|---|
| network | VPC, 6 subnets, 6 SGs, fck-nat ASG, 6 VPC Endpoints |
| data | RDS Postgres 15.12 (db.t4g.micro), ElastiCache Redis 7.1 (cache.t4g.micro) |
| storage | 3 S3 buckets (media / static / backup) |
| secrets | 9 Secrets Manager entries (2 自動生成 + 7 placeholder) |
| compute | ECS cluster, ALB, 3 ECR repos, 2 IAM roles |
| edge | CloudFront, Route53 zone + 2 A records, 2 ACM certs |
| observability | 5 Log Groups, SNS topic, 最大 8 alarms |

## 削除

```bash
# 二段階削除 (chicken-and-egg の逆)
# まず edge の OAC 参照を外す (storage / compute の変数を "" に戻す)
terraform apply

# 次に全 destroy
terraform destroy

# state bucket / lock table を削除する場合は
# docs/operations/tf-state-bootstrap.md の削除手順を参照
```

## コスト目安

ARCHITECTURE.md §11 参照: **~$153/月** (¥22-25k)

- VPC Interface Endpoints をオフにすれば $35 削減
- fck-nat と Interface Endpoint 両方オフなら外部 API 通信が失敗するので注意
