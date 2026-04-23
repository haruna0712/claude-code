variable "environment" {
  description = "環境名 (stg / prod)。ログ・アラーム名の prefix に使う。"
  type        = string
  validation {
    condition     = contains(["stg", "prod"], var.environment)
    error_message = "environment は stg / prod のいずれか。"
  }
}

variable "project" {
  description = "プロジェクト名 (リソース prefix)"
  type        = string
  default     = "sns"
}

variable "log_retention_days" {
  description = "CloudWatch Log Groups のログ保持日数"
  type        = number
  default     = 30
  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653], var.log_retention_days)
    error_message = "CloudWatch が受け入れる retention 値のみ指定可能。"
  }
}

variable "alert_email" {
  description = "アラート通知先メールアドレス (SNS Topic にサブスクライブ)"
  type        = string
  validation {
    condition     = can(regex("^[^@]+@[^@]+\\.[^@]+$", var.alert_email))
    error_message = "有効なメールアドレス形式で指定してください。"
  }
}

variable "ecs_services" {
  description = "CloudWatch Log Group を作る ECS サービス名リスト"
  type        = list(string)
  default = [
    "django",
    "next",
    "daphne",
    "celery-worker",
    "celery-beat",
  ]
}

variable "alb_arn_suffix" {
  description = "ALB の `arn_suffix` (5xx エラー率アラーム用)。未指定なら ALB アラームをスキップ。"
  type        = string
  default     = ""
}

variable "rds_instance_identifier" {
  description = "RDS インスタンス識別子 (CPU / 容量アラーム用)。未指定なら RDS アラームをスキップ。"
  type        = string
  default     = ""
}

variable "ecs_cluster_name" {
  description = "ECS Cluster 名 (サービス CPU アラーム用)。未指定ならスキップ。"
  type        = string
  default     = ""
}

variable "tags" {
  description = "全リソース共通タグ"
  type        = map(string)
  default     = {}
}
