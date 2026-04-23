variable "environment" {
  description = "環境名 (stg / prod)"
  type        = string
  validation {
    condition     = contains(["stg", "prod"], var.environment)
    error_message = "environment は stg / prod のいずれか。"
  }
}

variable "project" {
  description = "プロジェクト名 (IAM Role 名 prefix)"
  type        = string
  default     = "sns"
}

variable "github_owner" {
  description = "GitHub org/user (例: haruna0712)"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository 名 (owner を含まない。例: claude-code)"
  type        = string
}

variable "allowed_refs" {
  description = <<-EOT
    OIDC trust で許可する Git ref パターンのリスト。
    - "refs/heads/main"     : main ブランチ push 時のみ
    - "refs/pull/*/merge"   : すべての PR (fork 以外)
    - "environment:stg"     : GitHub Environments で stg を指定した workflow
    例: ["repo:haruna0712/claude-code:ref:refs/heads/main"]
    詳細: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect
  EOT
  type        = list(string)
  default     = []
}

variable "ecr_repository_arns" {
  description = "docker push を許可する ECR repository ARN のリスト"
  type        = list(string)
  default     = []
}

variable "ecs_cluster_arn" {
  description = "ecs update-service を許可する ECS Cluster ARN。空なら ECS 権限をスキップ。"
  type        = string
  default     = ""
}

variable "secrets_arn_prefix" {
  description = <<-EOT
    CD で読み取りを許可する Secrets Manager の ARN prefix (例:
    "arn:aws:secretsmanager:ap-northeast-1:123456789012:secret:sns/stg/*").
    空の場合 Secrets 権限を付与しない。
  EOT
  type        = string
  default     = ""
}

variable "tags" {
  description = "共通タグ"
  type        = map(string)
  default     = {}
}
