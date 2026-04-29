variable "project" {
  description = "Project name prefix (e.g., 'sns')"
  type        = string
}

variable "environment" {
  description = "Environment short name (e.g., 'stg')"
  type        = string
}

variable "aws_region" {
  type    = string
  default = "ap-northeast-1"
}

# ---------- Wired-in module outputs ----------

variable "ecs_cluster_arn" {
  type = string
}

variable "ecs_task_execution_role_arn" {
  type = string
}

variable "ecs_task_execution_role_name" {
  type        = string
  description = "Secrets Manager 読み取り policy をアタッチするため name も受け取る"
}

variable "ecs_task_role_arn" {
  type = string
}

variable "ecs_task_role_name" {
  type = string
}

variable "ecr_repository_urls" {
  type        = map(string)
  description = "service 論理名 → ECR URL"
}

variable "target_group_arns" {
  type        = map(string)
  description = "ALB target group 論理名 → ARN ('app' / 'next')"
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "ecs_security_group_id" {
  type = string
}

variable "secret_arns" {
  type        = map(string)
  description = "secrets module の secret_arns (path形式 'django/secret-key' → ARN)"
}

# ---------- Application config ----------

variable "rds_endpoint" {
  type      = string
  sensitive = true
}

variable "rds_database_name" {
  type    = string
  default = "sns"
}

variable "rds_username" {
  type    = string
  default = "sns"
}

variable "redis_url_template" {
  type        = string
  sensitive   = true
  description = "rediss://:{token}@host:port/0 (data モジュールの redis_url を流用、host:port のみ)"
}

variable "domain" {
  type        = string
  description = "アプリ公開ドメイン (例: stg.example.com) - CORS / ALLOWED_HOSTS で使用"
}

variable "cors_allowed_origins" {
  type        = string
  description = "CORS_ALLOWED_ORIGINS (カンマ区切り、F1-6)。例: 'https://stg.example.com'"
}

variable "image_tag" {
  type        = string
  default     = "stg-latest"
  description = "ECR image tag。CD は stg-{git-sha} で push するが、初回 apply 時は stg-latest"
}

# ---------- Resource sizing ----------

variable "django_cpu" {
  type    = number
  default = 512
}

variable "django_memory" {
  type    = number
  default = 1024
}

variable "django_desired_count" {
  type    = number
  default = 1
}

variable "next_cpu" {
  type    = number
  default = 256
}

variable "next_memory" {
  type    = number
  default = 512
}

variable "next_desired_count" {
  type    = number
  default = 1
}

variable "celery_cpu" {
  type    = number
  default = 256
}

variable "celery_memory" {
  type    = number
  default = 512
}

variable "log_retention_days" {
  type    = number
  default = 14
}

variable "tags" {
  type    = map(string)
  default = {}
}
