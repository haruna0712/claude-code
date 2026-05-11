# Edge module (P0.5-05)
#
# CloudFront 単一ディストリビューション + Route53 Hosted Zone +
# ACM 証明書 (us-east-1 / ap-northeast-1) を束ねる。
#
# 設計方針:
# - CloudFront は単一ディスト、Behavior で /api/*  /ws/*  /media/* を振り分け
# - webhook.<domain> は CloudFront を経由せず ALB 直 (Stripe 署名検証を壊さない、
#   ARCHITECTURE §1 / SPEC §17.3)
# - ACM は CloudFront 用に us-east-1 (provider alias)、ALB 用に ap-northeast-1 の 2 本

locals {
  prefix = "${var.project}-${var.environment}"

  app_fqdn     = "${var.app_subdomain}.${var.domain_name}"
  webhook_fqdn = "${var.webhook_subdomain}.${var.app_subdomain}.${var.domain_name}"
  ws_fqdn      = "${var.ws_subdomain}.${var.app_subdomain}.${var.domain_name}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "edge"
    },
    var.tags,
  )
}

# ---------------------------------------------------------------------------
# Route53 Hosted Zone
# ---------------------------------------------------------------------------

# お名前.com からの委任先。NS レコードを手動で更新する必要あり
# (docs/operations/dns-delegation.md、P0.5-10 で手順書)。
resource "aws_route53_zone" "this" {
  name = var.domain_name

  tags = merge(local.default_tags, { Name = var.domain_name })
}

# ---------------------------------------------------------------------------
# ACM Certificates
#   - CloudFront 用: us-east-1 (provider alias "us_east_1" を環境側で宣言)
#   - ALB 用: ap-northeast-1 (default provider)
#
#   両方とも DNS 検証で Route53 にレコード追加。
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "cloudfront" {
  provider = aws.us_east_1

  domain_name               = local.app_fqdn
  subject_alternative_names = [local.webhook_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-cloudfront-cert" })
}

resource "aws_acm_certificate" "alb" {
  domain_name               = local.app_fqdn
  subject_alternative_names = [local.webhook_fqdn, local.ws_fqdn]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-alb-cert" })
}

# DNS 検証レコード (両証明書で同じ検証レコードが出てくるため、for_each で重複排除)
locals {
  _cf_validation_options  = aws_acm_certificate.cloudfront.domain_validation_options
  _alb_validation_options = aws_acm_certificate.alb.domain_validation_options

  # map: record_name -> { name, type, record }
  cf_validation_records = {
    for dvo in local._cf_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  alb_validation_records = {
    for dvo in local._alb_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
}

resource "aws_route53_record" "cert_validation_cf" {
  for_each = local.cf_validation_records

  zone_id = aws_route53_zone.this.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true # ap-northeast-1 側と同じ record が出ることがある
}

resource "aws_route53_record" "cert_validation_alb" {
  for_each = local.alb_validation_records

  zone_id = aws_route53_zone.this.zone_id
  name    = each.value.name
  type    = each.value.type
  records = [each.value.record]
  ttl     = 60

  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation_cf : r.fqdn]
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation_alb : r.fqdn]
}

# ---------------------------------------------------------------------------
# CloudFront Origin Access Control (S3 bucket policy で使用)
# ---------------------------------------------------------------------------

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${local.prefix}-s3-oac"
  description                       = "OAC for media / static S3 buckets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ---------------------------------------------------------------------------
# CloudFront distribution (単一)
# Behaviors:
#   /_next/static/*  -> S3 static (long TTL)
#   /media/*         -> S3 media (long TTL、GET のみ)
#   /users/*         -> S3 media (profile avatar/header public objects)
#   /dm/*            -> S3 media (DM attachment objects)
#   /articles/*      -> S3 media (記事内画像、SecurityHeaders 付与) (P6-04)
#   /api/*           -> ALB  (no cache)
#   /ws/*            -> ALB  (no cache、WebSocket 透過)
#   / (default)      -> ALB  (Next.js SSR、short TTL)
# ---------------------------------------------------------------------------

# AWS Managed Cache policies
data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

# WebSocket /ws/* 用 (#281): AllViewer は viewer の Host ヘッダを Origin に転送するが、
# WebSocket Upgrade 時に CloudFront → ALB の経路で Host = stg.codeplace.me が
# CloudFront 内部処理と衝突して 403 を返すケースがある。
# AllViewerExceptHostHeader は Host だけ excluded → CloudFront が Origin の DNS 名
# (sns-stg-alb-...) を Host にセット。ALB は path-based routing で Host を見ないし、
# daphne (Channels OriginValidator) は HTTP `Origin` ヘッダを見るため、
# Host 書き換えは Phase 3 DM の動作に影響しない。
data "aws_cloudfront_origin_request_policy" "all_viewer_except_host" {
  name = "Managed-AllViewerExceptHostHeader"
}

data "aws_cloudfront_origin_request_policy" "cors_s3" {
  name = "Managed-CORS-S3Origin"
}

# AWS Managed Response Headers Policy: `SecurityHeadersPolicy`
# 提供する header (security-reviewer M-2 反映、 P6-04 / #527):
#   - X-Content-Type-Options: nosniff  (MIME sniffing 防止、 stored XSS 緩和)
#   - Strict-Transport-Security: max-age=31536000; includeSubDomains
#   - X-Frame-Options: SAMEORIGIN
#   - Referrer-Policy: strict-origin-when-cross-origin
#   - X-XSS-Protection: 1; mode=block
# /articles/* に attach することで、 MIME 偽装で stored XSS を試みる
# 攻撃 (HTML payload を image/png として upload) をブラウザ側で防ぐ。
# /dm/* と /users/* にも同じ policy を retrofit すべきだが、 本 PR
# スコープは /articles/* のみ (follow-up issue で対応)。
data "aws_cloudfront_response_headers_policy" "security_headers" {
  name = "Managed-SecurityHeadersPolicy"
}

resource "aws_cloudfront_distribution" "this" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.prefix} CloudFront"
  default_root_object = "" # Next.js SSR が index を返す
  price_class         = var.price_class
  aliases             = [local.app_fqdn]
  http_version        = "http2and3"

  # WAFv2 web ACL (CLOUDFRONT scope は us-east-1 のみ作成可)。
  # var.enable_waf = false の時は null を渡して紐付けを外す (負荷試験時のみ)。
  web_acl_id = var.enable_waf ? aws_wafv2_web_acl.cloudfront[0].arn : null

  # -------- Origins --------
  origin {
    origin_id   = "alb"
    domain_name = var.alb_dns_name

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "https-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = 60
      origin_read_timeout      = 60
    }
  }

  origin {
    origin_id                = "media"
    domain_name              = var.media_bucket_regional_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
    s3_origin_config {
      # OAC 使用時も s3_origin_config.origin_access_identity は空文字列を指定する必要あり
      origin_access_identity = ""
    }
  }

  origin {
    origin_id                = "static"
    domain_name              = var.static_bucket_regional_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
    s3_origin_config {
      origin_access_identity = ""
    }
  }

  # -------- Ordered cache behaviors --------
  # ⚠️ NOTE (architect PR #52 MEDIUM): AWS CloudFront は
  # `ordered_cache_behavior` を **Terraform 定義順 = API 送信順** で評価する。
  # 具体度ではなく先勝ち。新しい behavior を追加する際は既存 pattern と
  # 衝突しないよう順序を確認すること (例: /api/ws/* を入れる場合、/ws/* より
  # 先に定義しないと /api/ws/abc が /ws/* でマッチしてしまう)。

  # -------- Default behavior (Next.js SSR via ALB) --------
  default_cache_behavior {
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # -------- /_next/static/* → ALB (Next.js standalone server) --------
  # 当初は S3 静的バケットに publish して CDN 配信する設計だったが、CD パイプライン
  # に `aws s3 cp .next/static/ s3://<bucket>/_next/static/ --recursive` ステップを
  # まだ追加していないため S3 が空で全 asset が 403 になる (`/login` 等の画面が
  # CSS / JS 読まずに崩れる)。
  # 暫定: Next.js standalone server (ALB 配下) に直接 forward する。standalone は
  # `.next/static` をコンテナ内に同梱してるので self-serve できる。CloudFront 経由
  # で長期キャッシュを効かせる利点は失うが、stg ではスループット要件無いので OK。
  # CD に S3 publish ステップが入ったらここを `target_origin_id = "static"` に戻す。
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]
    compress               = true

    # ALB 由来のコンテンツでも長期キャッシュ可能 (Next.js が hash 付きファイル名で
    # immutable な前提)。
    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # -------- /media/* → S3 media --------
  ordered_cache_behavior {
    path_pattern           = "/media/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3.id
  }

  # -------- /users/* → S3 media --------
  ordered_cache_behavior {
    path_pattern           = "/users/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3.id
  }

  # -------- /dm/* → S3 media --------
  ordered_cache_behavior {
    path_pattern           = "/dm/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3.id
  }

  # -------- /articles/* → S3 media (P6-04 / #527) --------
  # 記事内画像 (apps.articles.s3_presign で issue する s3_key = articles/<user_id>/<uuid>.<ext>)
  # を配信する。 SecurityHeadersPolicy で nosniff + Strict-Transport-Security 等を付与し、
  # MIME 偽装による stored XSS (HTML payload を image/png として upload) をブラウザ側で
  # 防ぐ (security-reviewer M-2 反映)。
  ordered_cache_behavior {
    path_pattern           = "/articles/*"
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.cors_s3.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
  }

  # -------- /api/* → ALB (no cache) --------
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  # -------- /static/* → S3 static (Django collectstatic 出力) (#439) --------
  # Django admin が `<link href="/static/admin/css/base.css">` 形式で参照する
  # ためのルート。ECS の `/start` で `collectstatic` が走り `s3://<static_bucket>/static/`
  # にファイルが置かれている。OAC 経由で CloudFront からのみアクセス可。
  # base.py の STATICFILES_STORAGE は S3Storage だが
  # `AWS_S3_STATIC_CUSTOM_DOMAIN` を CloudFront ドメイン (= app_fqdn) に
  # 設定すれば Django が生成する URL もここを通る (services モジュール側で
  # 環境変数を入れる)。
  ordered_cache_behavior {
    path_pattern           = "/static/*"
    target_origin_id       = "static"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_optimized.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.cors_s3.id
  }

  # -------- /ws/* → ALB (WebSocket 透過) --------
  # ⚠️ WebSocket keepalive 要件 (architect PR #52 HIGH):
  #   - CloudFront viewer idle timeout = 10 分 (固定)
  #   - CloudFront origin_read_timeout = 60s (custom_origin_config で明示)
  #   - ALB idle_timeout = 3600s (compute モジュール側)
  #   この連携だと idle な接続は origin_read_timeout (60s) で切断される。
  #   クライアント (reconnecting-websocket) は自動再接続するが、Phase 3 DM で
  #   長時間セッションが続く場合は 30s 間隔で ping frame を送る運用が前提。
  #   将来 ws.<domain> を別途立てて CloudFront を bypass する選択肢あり (docs/adr)。
  #
  # #281: viewer_protocol_policy を https-only に厳格化 (redirect-to-https は
  # WebSocket クライアントが 301 を follow できず confuse する事例の予防)。
  # origin_request_policy を AllViewerExceptHostHeader に変更 (Host 転送が CF
  # WebSocket pass-through で 403 を引き起こすケースの回避、上記 data ブロック
  # コメント参照)。
  ordered_cache_behavior {
    path_pattern           = "/ws/*"
    target_origin_id       = "alb"
    viewer_protocol_policy = "https-only"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = false

    cache_policy_id          = data.aws_cloudfront_cache_policy.caching_disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-cloudfront" })
}

# ---------------------------------------------------------------------------
# Route53 A records
# ---------------------------------------------------------------------------

# app: stg.<domain> → CloudFront (alias)
# (additional_alb_record = true の場合は ALB 直にフォールバック、検証用)
resource "aws_route53_record" "app" {
  zone_id = aws_route53_zone.this.zone_id
  name    = local.app_fqdn
  type    = "A"

  alias {
    name                   = var.additional_alb_record ? var.alb_dns_name : aws_cloudfront_distribution.this.domain_name
    zone_id                = var.additional_alb_record ? var.alb_zone_id : aws_cloudfront_distribution.this.hosted_zone_id
    evaluate_target_health = false
  }
}

# webhook: webhook.stg.<domain> → ALB 直 (CloudFront 非経由)
# Stripe / GitHub webhook の HMAC 署名検証が body 変換で壊れないようにする
# (SPEC §17.3、security-reviewer PR #36 feedback)
resource "aws_route53_record" "webhook" {
  zone_id = aws_route53_zone.this.zone_id
  name    = local.webhook_fqdn
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# #281: WebSocket 専用サブドメイン (CloudFront を bypass して ALB 直結)。
# CloudFront 経由 wss:// が 403 を返す問題の根本対策。frontend は
# wss://ws.<app_fqdn>/ws/dm/<id>/ で接続し、daphne (Channels) と直接 handshake する。
# 既存の HTTP/HTTPS routes (api / next SSR / static) は引き続き CloudFront 経由。
resource "aws_route53_record" "ws" {
  zone_id = aws_route53_zone.this.zone_id
  name    = local.ws_fqdn
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

# ---------------------------------------------------------------------------
# WAFv2 web ACL (CLOUDFRONT scope)
#
# CLOUDFRONT scope の web ACL は us-east-1 のみで作成可能。`provider = aws.us_east_1`
# を明示する。
#
# ルール構成:
#   priority 1: AWSManagedRulesCommonRuleSet     (OWASP 系の汎用シグネチャ)
#   priority 2: AWSManagedRulesKnownBadInputsRuleSet (既知の悪意ある入力)
#   priority 3: AWSManagedRulesAmazonIpReputationList (脅威 IP リスト)
#   priority 10: rate-based rule                 (1 IP あたり 5 分間で var.waf_rate_limit_per_5min まで)
#
# 監視:
#   各ルールの sampled_requests_enabled = true で AWS Console 側のサンプル閲覧を有効化。
#   metric_name は `${local.prefix}-cf-<rule>` で CloudWatch にエクスポート。
# ---------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "cloudfront" {
  count    = var.enable_waf ? 1 : 0
  provider = aws.us_east_1

  name        = "${local.prefix}-cloudfront"
  description = "WAF for ${local.prefix} CloudFront distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-cf-common"
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-cf-bad-inputs"
    }
  }

  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-cf-ip-rep"
    }
  }

  rule {
    name     = "RateLimitPerIp"
    priority = 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      sampled_requests_enabled   = true
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-cf-rate-limit"
    }
  }

  visibility_config {
    sampled_requests_enabled   = true
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.prefix}-cloudfront-acl"
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-cloudfront-waf" })
}
