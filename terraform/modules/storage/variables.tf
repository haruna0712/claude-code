variable "environment" {
  description = "環境名 (stg / prod)"
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

variable "backup_transition_to_glacier_days" {
  description = "バックアップバケットで IA -> Glacier へ移行する日数"
  type        = number
  default     = 90
}

variable "backup_expiration_days" {
  description = "バックアップの完全削除までの日数。0 で削除しない。"
  type        = number
  default     = 730 # 2 年
  validation {
    condition     = var.backup_expiration_days == 0 || var.backup_expiration_days >= 7
    error_message = "0 (無期限) か 7 日以上を指定。"
  }
}

variable "cloudfront_oac_arn" {
  description = <<-EOT
    CloudFront Origin Access Control の ARN。
    media / static バケットは CloudFront 経由でのみ配信するため、bucket policy
    で sourceArn をこの OAC に限定する。空なら bucket policy をスキップ
    (edge モジュール実装前のフェーズで使用)。
  EOT
  type        = string
  default     = ""
}

variable "tags" {
  description = "全リソース共通タグ"
  type        = map(string)
  default     = {}
}
