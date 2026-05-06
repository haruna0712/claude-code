variable "project" {
  description = "Project name prefix (e.g., 'sns')"
  type        = string
}

variable "environment" {
  description = "Environment short name (e.g., 'stg')"
  type        = string
}

variable "aws_region" {
  description = "AWS region for ECS cluster and CloudWatch log groups."
  type        = string
  default     = "ap-northeast-1"
}

# ---------- Wired-in module outputs ----------

variable "ecs_cluster_arn" {
  description = "ARN of the ECS cluster from the compute module."
  type        = string
}

variable "ecs_task_execution_role_arn" {
  description = "ARN of the IAM role assumed by ECS to pull images and read secrets."
  type        = string
}

variable "ecs_task_execution_role_name" {
  description = "Name of the task execution role. Required because we attach a Secrets Manager read policy to it."
  type        = string
}

variable "ecs_task_role_arn" {
  description = "ARN of the IAM role assumed by the application container at runtime (AWS SDK access)."
  type        = string
}

variable "ecs_task_role_name" {
  description = "Name of the task role. Reserved for future runtime IAM policy attachments."
  type        = string
}

variable "ecr_repository_urls" {
  description = "Map of service logical name (django / next) → ECR repository URL produced by the compute module."
  type        = map(string)
}

variable "target_group_arns" {
  description = "Map of ALB target group logical name → ARN. Must contain 'app' (django), 'next' (Next.js SSR), and 'daphne' (Channels WebSocket, P3-13)."
  type        = map(string)
  validation {
    condition = (
      contains(keys(var.target_group_arns), "app") &&
      contains(keys(var.target_group_arns), "next") &&
      contains(keys(var.target_group_arns), "daphne")
    )
    error_message = "target_group_arns must contain 'app', 'next', and 'daphne' keys."
  }
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks (Fargate ENI placement)."
  type        = list(string)
}

variable "ecs_security_group_id" {
  description = "Security group attached to ECS tasks. Allows egress to RDS / Redis / Internet via NAT."
  type        = string
}

variable "secret_arns" {
  description = "Map of secret path (e.g., 'django/secret-key') → Secrets Manager ARN. Used in container 'secrets' blocks and IAM policy."
  type        = map(string)
}

# ---------- Application config ----------

variable "rds_endpoint" {
  description = "RDS endpoint (host) injected into POSTGRES_HOST. Sensitive to avoid leaking via terraform output."
  type        = string
  sensitive   = true
}

variable "rds_database_name" {
  description = "Database name created on RDS for the application."
  type        = string
  default     = "sns"
}

variable "rds_username" {
  description = "Database master username for the application's connection string. Defaults match the data module's `db_master_username` variable (= 'postgres')."
  type        = string
  default     = "postgres"
}

variable "redis_url_template" {
  description = "Full rediss:// URL with embedded AUTH token. Source: data module's redis_connection_url output. Sensitive."
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Public application domain (e.g., 'stg.example.com'). Used in CORS_ALLOWED_ORIGINS / ALLOWED_HOSTS / NEXT_PUBLIC_API_BASE_URL."
  type        = string
}

variable "media_bucket_name" {
  description = "S3 media bucket name used by Django presigned uploads."
  type        = string
}

variable "media_public_domain" {
  description = "Public CloudFront host for media URLs. Usually the app domain; CloudFront routes media prefixes to S3."
  type        = string
}

variable "static_bucket_name" {
  description = "S3 static bucket name used by Django collectstatic when S3 media storage is enabled."
  type        = string
}

variable "app_fqdn" {
  description = "Public app FQDN (e.g., 'stg.codeplace.me'). #439: Used as AWS_S3_STATIC_CUSTOM_DOMAIN so Django admin static URLs route through CloudFront's /static/* behavior."
  type        = string
}

variable "alb_dns_name" {
  description = "ALB DNS name (e.g., 'sns-stg-alb-xxx.ap-northeast-1.elb.amazonaws.com'). Used as the SSR fetch base URL injected into Next.js task definition (`API_BASE_URL`). Public domain (`var.domain`) was avoided because DNS delegation to Route53 is incomplete during stg bring-up; ALB DNS resolves to private IPs from inside the VPC."
  type        = string
}

variable "cors_allowed_origins" {
  description = "Comma-separated origins for django-cors-headers CORS_ALLOWED_ORIGINS (F1-6). Example: 'https://stg.example.com'."
  type        = string
}

variable "image_tag" {
  description = "ECR image tag pinned in task definitions. CD pushes 'stg-{git-sha}', initial apply uses 'stg-latest'."
  type        = string
  default     = "stg-latest"
}

# ---------- Resource sizing ----------

variable "django_cpu" {
  description = "Fargate CPU units for the Django (Gunicorn) task."
  type        = number
  default     = 512
}

variable "django_memory" {
  description = "Fargate memory (MiB) for the Django task."
  type        = number
  default     = 1024
}

variable "django_desired_count" {
  description = "Desired running count of Django tasks."
  type        = number
  default     = 1
}

variable "next_cpu" {
  description = "Fargate CPU units for the Next.js SSR task."
  type        = number
  default     = 256
}

variable "next_memory" {
  description = "Fargate memory (MiB) for the Next.js SSR task."
  type        = number
  default     = 512
}

variable "next_desired_count" {
  description = "Desired running count of Next.js SSR tasks."
  type        = number
  default     = 1
}

variable "celery_cpu" {
  description = "Fargate CPU units for celery-worker and celery-beat (single value shared)."
  type        = number
  default     = 256
}

variable "celery_memory" {
  description = "Fargate memory (MiB) for celery-worker and celery-beat."
  type        = number
  default     = 512
}

# ---------- daphne (P3-13 / Issue #238) ----------

variable "daphne_cpu" {
  description = "Fargate CPU units for the Daphne (Channels) task."
  type        = number
  default     = 256
}

variable "daphne_memory" {
  description = "Fargate memory (MiB) for the Daphne (Channels) task."
  type        = number
  default     = 512
}

variable "daphne_desired_count" {
  description = "Desired running count of Daphne tasks. ARCHITECTURE §3.5 で stg は min=1。"
  type        = number
  default     = 1
}

variable "daphne_autoscaling_min_capacity" {
  description = "Daphne の Application Auto Scaling 下限 (ARCHITECTURE §3.5)."
  type        = number
  default     = 1
}

variable "daphne_autoscaling_max_capacity" {
  description = "Daphne の Application Auto Scaling 上限 (ARCHITECTURE §3.5)."
  type        = number
  default     = 2
}

variable "daphne_autoscaling_cpu_target" {
  description = "Daphne の CPU target tracking 値 (パーセント、ARCHITECTURE §3.5 で 80%)."
  type        = number
  default     = 80
}

variable "log_retention_days" {
  description = "CloudWatch Logs retention for ECS task log groups."
  type        = number
  default     = 14
}

variable "tags" {
  description = "Common tags merged into every resource."
  type        = map(string)
  default     = {}
}
