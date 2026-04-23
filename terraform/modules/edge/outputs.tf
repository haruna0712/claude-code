output "route53_zone_id" {
  value = aws_route53_zone.this.zone_id
}

output "route53_name_servers" {
  description = "お名前.com で NS レコードに設定する 4 つの NS (docs/operations/dns-delegation.md)"
  value       = aws_route53_zone.this.name_servers
}

output "acm_cloudfront_arn" {
  description = "CloudFront 用 ACM 証明書 ARN (us-east-1)"
  value       = aws_acm_certificate_validation.cloudfront.certificate_arn
}

output "acm_alb_arn" {
  description = "ALB 用 ACM 証明書 ARN (ap-northeast-1)。compute モジュールに渡す。"
  value       = aws_acm_certificate_validation.alb.certificate_arn
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.this.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.this.domain_name
}

output "cloudfront_hosted_zone_id" {
  description = "Route53 alias の zone_id"
  value       = aws_cloudfront_distribution.this.hosted_zone_id
}

output "cloudfront_oac_id" {
  description = "Origin Access Control ID"
  value       = aws_cloudfront_origin_access_control.s3.id
}

output "cloudfront_oac_arn" {
  description = "Origin Access Control ARN (storage モジュールの bucket policy に渡す)"
  value       = "arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/${aws_cloudfront_distribution.this.id}"
}

output "app_fqdn" {
  value = local.app_fqdn
}

output "webhook_fqdn" {
  value = local.webhook_fqdn
}

data "aws_caller_identity" "current" {}
