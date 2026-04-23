variable "aws_region" {
  description = "stg の AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "project" {
  description = "プロジェクト名 (全リソース prefix に使う)"
  type        = string
  default     = "sns"
}

# ---------- DNS ----------

variable "domain_name" {
  description = "apex ドメイン (お名前.com で取得してある。例: example.com)"
  type        = string
}

variable "app_subdomain" {
  description = "アプリ用サブドメイン (結果: <app_subdomain>.<domain_name>)"
  type        = string
  default     = "stg"
}

# ---------- 通知 ----------

variable "alert_email" {
  description = "observability モジュールからのアラート送信先メール"
  type        = string
}

# ---------- RDS オーバーライド (環境別に調整しやすく) ----------

variable "rds_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "rds_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "rds_multi_az" {
  type    = bool
  default = false # stg は Single-AZ
}

variable "rds_skip_final_snapshot" {
  type    = bool
  default = false
}

# ---------- ElastiCache オーバーライド ----------

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.micro"
}

# ---------- 便利オプション ----------

variable "enable_vpc_endpoints" {
  description = "VPC Interface Endpoints (ECR/Secrets/Logs/STS) を作るか。月 $35 前後かかるのでオフにもできる。"
  type        = bool
  default     = true
}
