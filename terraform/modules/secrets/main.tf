# Secrets module (P0.5-09)
#
# Secrets Manager に Django / RDS / 外部 API のシークレット "枠" を作る。
#
# 方針:
# 1. 自動生成できるもの (Django SECRET_KEY / DB password): random_password で生成して
#    put-secret-value。terraform state には入るが、.tfstate は暗号化済み S3 backend
#    に保存されるので漏洩リスクは限定的。
# 2. 外部由来のシークレット (Mailgun / Stripe / OpenAI / Claude / Sentry DSN):
#    placeholder で作成し、運用者が `aws secretsmanager put-secret-value` で
#    実値を書き込む。terraform で管理するのは「存在と ARN」のみ。
#
# 命名規則: sns/<env>/<category>/<key>
#   - Django:   sns/stg/django/secret-key, sns/stg/django/db-password
#   - Sentry:   sns/stg/sentry/dsn
#   - Mailgun:  sns/stg/mailgun/api-key, sns/stg/mailgun/signing-key
#   - Stripe:   sns/stg/stripe/secret-key, sns/stg/stripe/webhook-secret
#   - OpenAI:   sns/stg/openai/api-key
#   - Anthropic sns/stg/anthropic/api-key

locals {
  prefix = "sns/${var.environment}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "secrets"
    },
    var.tags,
  )

  # 自動生成グループ: terraform が値を put する
  generated_secrets = {
    "django/secret-key"  = { description = "Django SECRET_KEY", length = 64, special = true }
    "django/db-password" = { description = "RDS master password", length = 40, special = false } # RDS の制約で記号制限あり
  }

  # Placeholder グループ: terraform は枠だけ作る
  placeholder_secrets = {
    "sentry/dsn"             = "Sentry Django/Celery DSN (https://...@sentry.io/...)"
    "mailgun/api-key"        = "Mailgun API key (Phase 1 以降で利用)"
    "mailgun/signing-key"    = "Mailgun webhook signing key"
    "stripe/secret-key"      = "Stripe Secret Key (sk_test_... / sk_live_...)"
    "stripe/webhook-secret"  = "Stripe webhook signing secret (whsec_...)"
    "openai/api-key"         = "OpenAI API key (Phase 7 Bot 要約)"
    "anthropic/api-key"      = "Anthropic API key (Phase 8 記事下書き AI)"
  }
}

# ---------------------------------------------------------------------------
# Auto-generated secrets
# ---------------------------------------------------------------------------

resource "random_password" "generated" {
  for_each = var.generate_random_values ? local.generated_secrets : {}

  length  = each.value.length
  special = each.value.special
  # RDS master password に使える記号のみ (RDS 制約: / @ " space は NG)
  override_special = each.value.special ? "_-+=!#$%^&*()" : ""
}

resource "aws_secretsmanager_secret" "generated" {
  for_each = local.generated_secrets

  name                    = "${local.prefix}/${each.key}"
  description             = each.value.description
  recovery_window_in_days = var.recovery_window_in_days

  tags = merge(local.default_tags, { Key = each.key })
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each = var.generate_random_values ? local.generated_secrets : {}

  secret_id     = aws_secretsmanager_secret.generated[each.key].id
  secret_string = random_password.generated[each.key].result

  # 運用者が手動で put-secret-value で上書きした場合、terraform がそれを
  # revert しないように ignore する。random_password を変更すると意図的に
  # ローテートする運用。
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Placeholder secrets (terraform は枠だけ、値は運用者が手動 put)
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "placeholder" {
  for_each = local.placeholder_secrets

  name                    = "${local.prefix}/${each.key}"
  description             = each.value
  recovery_window_in_days = var.recovery_window_in_days

  tags = merge(local.default_tags, { Key = each.key })
}

resource "aws_secretsmanager_secret_version" "placeholder_initial" {
  for_each = local.placeholder_secrets

  secret_id     = aws_secretsmanager_secret.placeholder[each.key].id
  secret_string = jsonencode({
    note = "SET_VIA_AWS_CLI: aws secretsmanager put-secret-value --secret-id ${local.prefix}/${each.key} --secret-string ...",
  })

  # 手動 put で上書きされても terraform が戻さない
  lifecycle {
    ignore_changes = [secret_string]
  }
}
