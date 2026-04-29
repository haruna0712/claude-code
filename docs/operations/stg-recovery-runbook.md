# stg 環境復旧 runbook (destroy 後の再 apply 手順)

> Generated: 2026-04-29 / 対応: PR #196 merge 後の Phase 1 デプロイ準備
> 状況: 2026-04-27 に `terraform destroy` 実行 → 11 resources 削除 → 再 apply は
> Secrets Manager の 7 日 recovery 期間 (〜2026-05-04) で失敗。
> このランブックは **terraform-search-import** skill ベースの手順。

---

## 0. 前提

- AWS CLI 設定済 (`aws sts get-caller-identity` で確認)
- Terraform 1.5+ (本リポジトリ pin: `>= 1.5`)
- `cd terraform/environments/stg/` で実行
- 現在の AWS account id: `aws sts get-caller-identity --query Account --output text`

---

## 1. AWS 現状把握 (read-only discovery)

destroy 後に何が残っているかを確認する。**何も書き換えないコマンドのみ。**

```bash
# 環境変数で揃える
export AWS_REGION=ap-northeast-1
export PROJECT=sns
export ENV=stg

echo "=== 1. Secrets Manager (7日 recovery 中シークレット含む) ==="
aws secretsmanager list-secrets \
  --include-planned-deletion \
  --query "SecretList[?starts_with(Name, '${PROJECT}/${ENV}/')].{Name:Name, Deleted:DeletedDate, ScheduledDeletion:ScheduledDeletionDate}" \
  --output table

echo "=== 2. Route53 hosted zone ==="
aws route53 list-hosted-zones \
  --query "HostedZones[?contains(Name, 'YOUR_DOMAIN')].{Id:Id, Name:Name, Records:ResourceRecordSetCount}" \
  --output table
# YOUR_DOMAIN は terraform.tfvars の domain_name に置換

echo "=== 3. S3 buckets ==="
aws s3api list-buckets \
  --query "Buckets[?starts_with(Name, '${PROJECT}-${ENV}-')].{Name:Name, Created:CreationDate}" \
  --output table

echo "=== 4. ECR repositories ==="
aws ecr describe-repositories \
  --query "repositories[?starts_with(repositoryName, '${PROJECT}-${ENV}-')].{Name:repositoryName, Created:createdAt}" \
  --output table

echo "=== 5. IAM roles (GitHub OIDC + ECS task) ==="
aws iam list-roles \
  --query "Roles[?starts_with(RoleName, '${PROJECT}-${ENV}-')].{Name:RoleName, Created:CreateDate}" \
  --output table

echo "=== 6. VPC ==="
aws ec2 describe-vpcs \
  --filters "Name=tag:Project,Values=${PROJECT}" "Name=tag:Environment,Values=${ENV}" \
  --query "Vpcs[].{Id:VpcId, Cidr:CidrBlock}" \
  --output table

echo "=== 7. RDS instances (削除予約も含む) ==="
aws rds describe-db-instances \
  --query "DBInstances[?starts_with(DBInstanceIdentifier, '${PROJECT}-${ENV}-')].{Id:DBInstanceIdentifier, Status:DBInstanceStatus, Engine:Engine}" \
  --output table

echo "=== 8. ElastiCache replication groups ==="
aws elasticache describe-replication-groups \
  --query "ReplicationGroups[?starts_with(ReplicationGroupId, '${PROJECT}-${ENV}-')].{Id:ReplicationGroupId, Status:Status}" \
  --output table

echo "=== 9. CloudFront distributions (destroy で消えにくい) ==="
aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Comment, '${PROJECT}-${ENV}')].{Id:Id, Domain:DomainName, Status:Status}" \
  --output table

echo "=== 10. ACM certificates (us-east-1 / ap-northeast-1) ==="
for region in us-east-1 ap-northeast-1; do
  aws acm list-certificates --region $region \
    --query "CertificateSummaryList[?contains(DomainName, 'YOUR_DOMAIN')].{Arn:CertificateArn, Domain:DomainName, Status:Status}" \
    --output table
done
```

**判断基準:**
- 残存 = terraform import で取り込む候補 (Route53 hosted zone, ECR, IAM/OIDC role, S3 backup bucket, CloudFront など作り直しコストが高いもの)
- 削除予約 = restore-secret + import / force-delete どちらかを選ぶ
- 不存在 = terraform apply で新規作成 (VPC, RDS, ElastiCache 等)

---

## 2. Secrets Manager: restore + import 戦略

destroy 後 7 日 recovery 中のシークレットは **2 つの選択肢**:

| Option | 手順 | メリット | デメリット |
|---|---|---|---|
| **A: 値を残す** | `restore-secret` + `terraform import` で state に取り込む | 既存の Redis AUTH token / Django SECRET_KEY を維持、サービス再起動不要 | terraform random_password との整合に注意 |
| **B: 値を新規生成** | `force-delete-without-recovery` で完全削除 → terraform apply で新規 | シンプル、stg なら影響軽微 | Redis を絡めると client が切断 (stg は単体なので OK) |

**stg では Option B (force-delete) を推奨**: シンプルで 7日 recovery を待つ必要なし。Option A は本番 (prod) で必要になる手順として参考。

### Option A: restore + import (詳細)

```bash
# 2-A-1. リストアップ
SECRETS=(
  "${PROJECT}/${ENV}/django/secret-key"
  "${PROJECT}/${ENV}/django/db-password"
  "${PROJECT}/${ENV}/django/jwt-signing-key"   # F1-3 で追加
  "${PROJECT}/${ENV}/redis/auth-token"
  "${PROJECT}/${ENV}/sentry/dsn"
  "${PROJECT}/${ENV}/mailgun/api-key"
  "${PROJECT}/${ENV}/mailgun/signing-key"
  "${PROJECT}/${ENV}/stripe/secret-key"
  "${PROJECT}/${ENV}/stripe/webhook-secret"
  "${PROJECT}/${ENV}/openai/api-key"
  "${PROJECT}/${ENV}/anthropic/api-key"
  "${PROJECT}/${ENV}/google/oauth-client-id"      # F1-3 で追加
  "${PROJECT}/${ENV}/google/oauth-client-secret"  # F1-3 で追加
)

# 2-A-2. 全件 restore (idempotent: 既に restored なら no-op で成功)
for s in "${SECRETS[@]}"; do
  echo "Restoring $s ..."
  aws secretsmanager restore-secret --secret-id "$s" 2>&1 | tee -a /tmp/restore.log || true
done

# 2-A-3. terraform import
# secrets module は path key (例: "django/secret-key") で for_each している。
# generated グループ (4 個) と placeholder グループ (9 個) で resource address が異なるので注意。

# generated group (terraform が値を put する)
for key in django/secret-key django/db-password django/jwt-signing-key redis/auth-token; do
  arn=$(aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/${key}" --query ARN --output text)
  terraform import "module.secrets.aws_secretsmanager_secret.generated[\"${key}\"]" "$arn"
done

# placeholder group (terraform は枠だけ作る)
for key in sentry/dsn mailgun/api-key mailgun/signing-key stripe/secret-key stripe/webhook-secret \
           openai/api-key anthropic/api-key google/oauth-client-id google/oauth-client-secret; do
  arn=$(aws secretsmanager describe-secret --secret-id "${PROJECT}/${ENV}/${key}" --query ARN --output text)
  terraform import "module.secrets.aws_secretsmanager_secret.placeholder[\"${key}\"]" "$arn"
done

# 2-A-4. terraform plan で差分確認
terraform plan -out=plan.tfplan
# 期待される差分:
# - aws_secretsmanager_secret_version は新しい value で update される (random_password の新値で AWS 側を上書き)
#   → これを避けたい場合は事前に `aws secretsmanager put-secret-value` で
#     現在の AWS 側の値を terraform state にも反映させる workaround が必要 (本 runbook では skip)
```

### Option B: force-delete (推奨)

```bash
# 7日待たずに完全削除
for s in "${SECRETS[@]}"; do
  echo "Force-deleting $s ..."
  aws secretsmanager delete-secret \
    --secret-id "$s" \
    --force-delete-without-recovery 2>&1 | tee -a /tmp/force_delete.log || true
done

# 完全削除後 30 秒ほど待つ (Secrets Manager の整合性確保)
sleep 30

# その後 terraform apply で新規作成 (3. のフェーズへ)
```

---

## 3. terraform apply フロー

destroy 前と異なる点:
- **services モジュールが新規追加** (PR #196 で導入: ECS task definition + service)
- **secrets module に新エントリ** (jwt-signing-key, google/oauth-client-{id,secret})

### 3-1. apply (二段階)

P0.5 の deploy runbook 準拠の二段階 apply:

```bash
cd /workspace/terraform/environments/stg/

# ステージ 1: edge / certificate を作る前 (CloudFront / ACM 以外)
terraform apply -target='module.network' \
                -target='module.secrets' \
                -target='module.data' \
                -target='module.storage' \
                -target='module.compute' \
                -target='module.observability' \
                -auto-approve

# ステージ 2: edge (ACM 検証 + CloudFront) — DNS 委任完了が前提
# 委任手順は docs/operations/dns-delegation.md
terraform apply -target='module.edge' -auto-approve

# ステージ 3: services モジュール (ECS task def / service)
# compute モジュールの IAM role / ECR / target group がすべて作成済が前提
terraform apply -target='module.services' -auto-approve

# 最後に全体 apply で残差確認
terraform apply
```

### 3-2. apply 後の出力取得

```bash
# GitHub Variables 設定用の値を取得
terraform output -raw ecs_services_csv          # → vars.ECS_SERVICES
terraform output -raw ecs_migrate_task_definition  # → vars.ECS_MIGRATE_TASK_DEFINITION
terraform output -raw ecs_private_subnets_csv      # → vars.ECS_PRIVATE_SUBNETS
terraform output -raw ecs_security_group_id        # → vars.ECS_SECURITY_GROUP
terraform output -raw alb_dns_name                  # 確認用
```

### 3-3. Secrets Manager に値を put (placeholder のみ)

```bash
# Sentry DSN (https://...@sentry.io/...)
aws secretsmanager put-secret-value --secret-id sns/stg/sentry/dsn \
  --secret-string "https://YOUR_KEY@oXXXXX.ingest.sentry.io/PROJECT_ID"

# Google OAuth (Cloud Console から取得)
aws secretsmanager put-secret-value --secret-id sns/stg/google/oauth-client-id \
  --secret-string "XXXXX.apps.googleusercontent.com"
aws secretsmanager put-secret-value --secret-id sns/stg/google/oauth-client-secret \
  --secret-string "GOCSPX-XXXXX"

# Mailgun (送信ドメイン用)
aws secretsmanager put-secret-value --secret-id sns/stg/mailgun/api-key \
  --secret-string "key-XXXXX"
aws secretsmanager put-secret-value --secret-id sns/stg/mailgun/signing-key \
  --secret-string "XXXXX"

# Stripe / OpenAI / Anthropic は Phase 7-8 で利用、stg では空のままで OK
```

---

## 4. GitHub Variables 登録

Settings → Secrets and variables → Actions → Variables (Repository):

| Name | Value (terraform output から取得) |
|---|---|
| `AWS_REGION` | `ap-northeast-1` |
| `AWS_DEPLOY_ROLE_ARN` | `aws iam list-roles --query "Roles[?contains(RoleName,'github-actions')].Arn" --output text` |
| `ECR_BACKEND_REPOSITORY` | `<account>.dkr.ecr.ap-northeast-1.amazonaws.com/sns-stg-django` |
| `ECR_FRONTEND_REPOSITORY` | `<account>.dkr.ecr.ap-northeast-1.amazonaws.com/sns-stg-next` |
| `ECR_NGINX_REPOSITORY` | `<account>.dkr.ecr.ap-northeast-1.amazonaws.com/sns-stg-nginx` (将来追加用) |
| `ECS_CLUSTER` | `sns-stg-cluster` |
| `ECS_SERVICES` | `terraform output -raw ecs_services_csv` |
| `ECS_MIGRATE_TASK_DEFINITION` | `terraform output -raw ecs_migrate_task_definition` |
| `ECS_PRIVATE_SUBNETS` | `terraform output -raw ecs_private_subnets_csv` |
| `ECS_SECURITY_GROUP` | `terraform output -raw ecs_security_group_id` |
| `SMOKE_URL` | `https://stg.<your-domain>` |

GitHub CLI でまとめて設定:

```bash
gh variable set AWS_REGION --body "ap-northeast-1"
gh variable set ECS_CLUSTER --body "sns-stg-cluster"
gh variable set ECS_SERVICES --body "$(terraform output -raw ecs_services_csv)"
gh variable set ECS_MIGRATE_TASK_DEFINITION --body "$(terraform output -raw ecs_migrate_task_definition)"
gh variable set ECS_PRIVATE_SUBNETS --body "$(terraform output -raw ecs_private_subnets_csv)"
gh variable set ECS_SECURITY_GROUP --body "$(terraform output -raw ecs_security_group_id)"
gh variable set SMOKE_URL --body "https://stg.YOUR_DOMAIN"
# AWS_DEPLOY_ROLE_ARN / ECR_* は手動で取得して set
```

---

## 5. 最終 deploy トリガー

```bash
# main ブランチに PR #196 を merge
gh pr merge 196 --squash --delete-branch

# CD stg ワークフローが自動起動 (build → migrate → deploy → smoke)
gh run watch --exit-status
```

**期待される job の流れ:**
1. **build**: Docker image を ECR に push (~5 分)
2. **migrate**: `aws ecs run-task` で `sns-stg-django-migrate` を起動 → Django migrations を実行 (~2 分)
3. **deploy**: 4 service を `force-new-deployment` + `services-stable` 待機 (~5-8 分)
4. **smoke-test**: `curl https://stg.<domain>/api/health/` が 200 (5 retry)

---

## 6. トラブルシュート

| 症状 | 原因 | 対処 |
|---|---|---|
| `restore-secret` が `ResourceNotFoundException` | 既に完全削除済 | 何もせず terraform apply で新規作成 |
| terraform import が `Error: resource address ... does not exist` | for_each キーの quote 忘れ | `terraform import 'module.X.Y.Z["key"]' arn` (シングルクォートで囲む) |
| ECS task が起動直後に exit | Secrets Manager の値未設定 (Sentry DSN 等) | `aws secretsmanager put-secret-value` で値を入れて service を再起動 |
| ALB target group が unhealthy | Django container の health check (`/api/health/`) が 503 | RDS migrations 未実行の可能性 → migrate job のログ確認 |
| `aws ecs wait services-stable` がタイムアウト | image pull 失敗 / health check 失敗 | CloudWatch logs `/ecs/sns-stg/<service>` を確認 |

---

## 7. ロールバック

万一 deploy 後に重大な不具合があれば:

```bash
# 直前の image tag に戻す (ECR の stg-PREV-SHA を採用)
gh workflow run cd-stg.yml -f image_tag=stg-<prev-sha>

# または ECS service ごと desired_count=0 で停止
aws ecs update-service --cluster sns-stg-cluster --service sns-stg-django --desired-count 0
```
