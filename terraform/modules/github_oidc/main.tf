# GitHub Actions OIDC provider + IAM Role (P0.5-13)
#
# GitHub Actions から AWS へ short-lived credential で認証するための IAM Role。
# アクセスキーをリポジトリ secrets に置かないことで、キー流出・ローテ漏れを根本解決する。
#
# 参考: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services

locals {
  prefix = "${var.project}-${var.environment}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "github_oidc"
    },
    var.tags,
  )

  # `sub` claim のデフォルトパターン。
  # `refs/heads/main` への push のみ許可する最小構成。CI でテストだけ走らせたい
  # PR は「environment: pr」ではなく `contents:read` のみの token で別経路推奨。
  default_allowed_refs = [
    "repo:${var.github_owner}/${var.github_repo}:ref:refs/heads/main",
  ]

  allowed_refs = length(var.allowed_refs) > 0 ? var.allowed_refs : local.default_allowed_refs
}

# ---------------------------------------------------------------------------
# OIDC Identity Provider
# すでに同アカウントで GitHub Actions OIDC provider が作られている場合はこの
# リソースを削除して data source で参照する運用に切り替えるか、module を
# skip する変数を足す。Phase 0.5 では新規アカウント前提で常に作成する。
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github_actions" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]

  # GitHub 公式のルート証明書 thumbprint (2026 時点の最新)。
  # 将来 GitHub が回転した際はこの値を更新する。
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]

  tags = local.default_tags
}

# ---------------------------------------------------------------------------
# Trust policy: GitHub Actions workflow からの AssumeRoleWithWebIdentity を許可
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github_actions.arn]
    }

    # audience を sts.amazonaws.com に固定
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # sub claim が allowed_refs のいずれかに一致する workflow のみ許可
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.allowed_refs
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = "${local.prefix}-github-actions"
  description        = "Assumed by GitHub Actions via OIDC for stg deploy"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600

  tags = local.default_tags
}

# ---------------------------------------------------------------------------
# Permissions: ECR push + ECS update-service + Secrets read + CloudWatch Logs
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecr_push" {
  count = length(var.ecr_repository_arns) > 0 ? 1 : 0

  # ECR repo に push するのに必要な最小 set。
  statement {
    sid    = "EcrAuthToken"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    # GetAuthorizationToken は resource level で絞れない
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = var.ecr_repository_arns
  }
}

resource "aws_iam_role_policy" "ecr_push" {
  count = length(var.ecr_repository_arns) > 0 ? 1 : 0

  name   = "ecr-push"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.ecr_push[0].json
}

data "aws_iam_policy_document" "ecs_deploy" {
  count = var.ecs_cluster_arn == "" ? 0 : 1

  statement {
    sid    = "EcsListServices"
    effect = "Allow"
    actions = [
      "ecs:DescribeServices",
      "ecs:DescribeTasks",
      "ecs:DescribeTaskDefinition",
      "ecs:ListTasks",
    ]
    resources = ["*"] # 上記 Describe 系は resource level 絞りにくい
  }

  statement {
    sid    = "EcsUpdateService"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:RegisterTaskDefinition",
      "ecs:DeregisterTaskDefinition",
      "ecs:RunTask", # マイグレーション run-task 用
      "ecs:StopTask",
    ]
    resources = ["*"] # UpdateService は cluster ARN 指定可能だが RegisterTaskDefinition は不可
    condition {
      test     = "StringEquals"
      variable = "ecs:cluster"
      values   = [var.ecs_cluster_arn]
    }
  }

  # ECS タスク実行ロールを PassRole する必要あり
  statement {
    sid       = "EcsPassRole"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "ecs_deploy" {
  count = var.ecs_cluster_arn == "" ? 0 : 1

  name   = "ecs-deploy"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.ecs_deploy[0].json
}

data "aws_iam_policy_document" "secrets_read" {
  count = var.secrets_arn_prefix == "" ? 0 : 1

  statement {
    sid       = "ReadScopedSecrets"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [var.secrets_arn_prefix]
  }
}

resource "aws_iam_role_policy" "secrets_read" {
  count = var.secrets_arn_prefix == "" ? 0 : 1

  name   = "secrets-read"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.secrets_read[0].json
}

# CloudWatch Logs (ECS run-task のログ tail 用)
data "aws_iam_policy_document" "logs_read" {
  statement {
    sid    = "CloudWatchLogsRead"
    effect = "Allow"
    actions = [
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:log-group:/ecs/${local.prefix}/*"]
  }
}

resource "aws_iam_role_policy" "logs_read" {
  name   = "logs-read"
  role   = aws_iam_role.github_actions.id
  policy = data.aws_iam_policy_document.logs_read.json
}
