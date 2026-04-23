# `secrets` module

Secrets Manager にシークレットの枠を一括で作成する。

## 命名規約

```
sns/<env>/<category>/<key>
```

例:
- `sns/stg/django/secret-key`
- `sns/stg/django/db-password`
- `sns/stg/stripe/secret-key`
- `sns/stg/openai/api-key`

ECS task definition の `secrets` 属性で ARN 参照し、ランタイム環境変数にバインドする。

## 2 種類のシークレット

### 自動生成 (terraform が put)

| キー | 用途 | 方式 |
|---|---|---|
| `django/secret-key` | Django SECRET_KEY | `random_password` (length 64, special 可) |
| `django/db-password` | RDS master password | `random_password` (length 40, RDS 互換の記号のみ) |

`var.generate_random_values = true` (default) の時だけ put される。
`lifecycle.ignore_changes = [secret_string]` で、運用者が `aws secretsmanager
put-secret-value` で手動ローテートした後、次回 apply が戻さないようにしている。

### Placeholder (運用者が手動 put)

外部由来のシークレットは terraform では枠のみ作成:

| キー | 取得元 |
|---|---|
| `sentry/dsn` | Sentry プロジェクト設定 |
| `mailgun/api-key` | Mailgun コントロールパネル |
| `mailgun/signing-key` | Mailgun Webhook signing key |
| `stripe/secret-key` | Stripe ダッシュボード (test / live) |
| `stripe/webhook-secret` | Stripe Webhook endpoint の signing secret |
| `openai/api-key` | OpenAI platform |
| `anthropic/api-key` | Anthropic console |

初期状態では `{"note": "SET_VIA_AWS_CLI: ..."}` という placeholder が入る。
運用者が実値を書き込むコマンド例:

```bash
aws secretsmanager put-secret-value \
  --secret-id sns/stg/stripe/secret-key \
  --secret-string "sk_test_xxxxx"
```

## recovery_window_in_days

Secrets Manager は削除時に論理削除状態になり、指定日数内に `restore-secret` で復旧可能。
- stg: 7 日 (default)
- prod: 30 日を推奨

`0` を指定すると即時削除 (テスト環境で作り直したいとき用)。

## 使用例

```hcl
module "secrets" {
  source = "../../modules/secrets"

  environment              = "stg"
  project                  = "sns"
  generate_random_values   = true
  recovery_window_in_days  = 7
}

# 他モジュールに ARN を渡す
module "data" {
  source              = "../../modules/data"
  db_password_arn     = module.secrets.db_password_arn
  db_password_value   = module.secrets.db_password_value # RDS 作成時の MasterUserPassword
  # ...
}

module "compute" {
  source          = "../../modules/compute"
  secret_arns_map = module.secrets.secret_arns
  # ...
}
```

## IAM 連携

ECS task execution role が必要な `secretsmanager:GetSecretValue` permission:

```hcl
resource "aws_iam_role_policy" "task_execution_read_secrets" {
  role   = aws_iam_role.ecs_task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = module.secrets.all_secret_arns_list
    }]
  })
}
```

## 今後の拡張

- **ローテーション自動化**: `aws_secretsmanager_secret_rotation` + Lambda (DB password を 30 日ごと)
- **KMS CMK**: 現状は AWS managed key。prod では CMK で IAM / CloudTrail 可視化強化
- **tfvars に生 secret を入れない**: 本モジュールは terraform state に DB password が
  入るが、state は暗号化 S3 backend (P0.5-01) + DynamoDB lock の下で保存される。
  prod では別途 External Secret Store (1Password / HashiCorp Vault) との同期を検討
