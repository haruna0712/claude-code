output "rds_instance_id" {
  description = "RDS インスタンス識別子 (observability モジュールの alarm dimension に渡す)"
  value       = aws_db_instance.this.id
}

output "rds_endpoint" {
  description = "RDS endpoint (host:port 形式)"
  value       = aws_db_instance.this.endpoint
}

output "rds_address" {
  description = "RDS hostname (port なし)"
  value       = aws_db_instance.this.address
}

output "rds_port" {
  value = aws_db_instance.this.port
}

output "rds_database_name" {
  value = aws_db_instance.this.db_name
}

output "rds_master_username" {
  value = aws_db_instance.this.username
}

output "rds_parameter_group_name" {
  value = aws_db_parameter_group.postgres15.name
}

output "rds_arn" {
  value = aws_db_instance.this.arn
}

output "redis_id" {
  value = aws_elasticache_replication_group.this.id
}

output "redis_primary_endpoint" {
  description = "Redis primary endpoint (writes 用)。replication_group の primary endpoint。"
  value       = aws_elasticache_replication_group.this.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint (replicas へのラウンドロビン)。replicas が 0 なら primary と同じ挙動。"
  value       = aws_elasticache_replication_group.this.reader_endpoint_address
}

output "redis_port" {
  value = aws_elasticache_replication_group.this.port
}

output "redis_connection_url" {
  description = <<-EOT
    Django settings / Celery に渡す REDIS_URL。
    rediss:// (TLS) + AUTH token 埋め込み。sensitive。
    アプリ側で SecretsManager から auth-token を fetch して
    redis://primary_endpoint:port/0 + ssl=True を組み立てる方が
    本来は望ましいが、stg は簡略化のためここで完成形を返す。
  EOT
  # `?ssl_cert_reqs=CERT_REQUIRED` は kombu/celery の rediss:// 必須パラメータ。
  # 無いと `ValueError: A rediss:// URL must have parameter ssl_cert_reqs ...` で
  # celery worker が起動失敗する (django redis cache 側は redis-py がデフォルトで
  # CERT_REQUIRED 扱いするので問題ない)。
  value     = "rediss://:${var.redis_auth_token}@${aws_elasticache_replication_group.this.primary_endpoint_address}:${aws_elasticache_replication_group.this.port}/0?ssl_cert_reqs=CERT_REQUIRED"
  sensitive = true
}
