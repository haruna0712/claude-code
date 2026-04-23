# Storage module (P0.5-08)
#
# S3 buckets: media (ユーザー画像) / static (Next.js 静的アセット) / backup
# (RDS スナップショット・Meilisearch ダンプ等)。
#
# 共通ポリシー:
# - Versioning: 有効 (誤削除復旧 + 監査)
# - Encryption: SSE-S3 (AES256)
# - Public Access: 完全遮断
# - Object Ownership: BucketOwnerEnforced (ACL 無効化)
# - Lifecycle: bucket ごとに個別定義

locals {
  prefix = "${var.project}-${var.environment}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "storage"
    },
    var.tags,
  )

  buckets = {
    media   = { name = "${local.prefix}-media", purpose = "user-uploaded content (avatars, tweet images, DM attachments)" }
    static  = { name = "${local.prefix}-static", purpose = "Next.js static assets via CloudFront" }
    backup  = { name = "${local.prefix}-backup", purpose = "RDS / Meilisearch / app-level backups" }
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets

  bucket        = each.value.name
  force_destroy = false # 誤削除防止。prod teardown 時のみ override。

  tags = merge(local.default_tags, {
    Name    = each.value.name
    Purpose = each.value.purpose
    Bucket  = each.key
  })
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# ---------------------------------------------------------------------------
# Lifecycle rules — bucket ごとに個別の方針
# ---------------------------------------------------------------------------

# backup: IA -> Glacier -> 期限削除
resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.this["backup"].id

  rule {
    id     = "transition-to-glacier"
    status = "Enabled"

    filter {} # 全オブジェクト対象

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }
    transition {
      days          = var.backup_transition_to_glacier_days
      storage_class = "GLACIER"
    }

    dynamic "expiration" {
      for_each = var.backup_expiration_days > 0 ? [1] : []
      content {
        days = var.backup_expiration_days
      }
    }

    # 旧バージョンは 30 日後に削除 (バージョニングで無限に膨らむのを防ぐ)
    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# media: 旧バージョンのみ削除、本体は永続
resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.this["media"].id

  rule {
    id     = "cleanup-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# static: CloudFront 配信なのでキャッシュが効く。古いデプロイの静的ファイルは
# CloudFront invalidation 後に IA へ移して節約。
resource "aws_s3_bucket_lifecycle_configuration" "static" {
  bucket = aws_s3_bucket.this["static"].id

  rule {
    id     = "static-transition-to-ia"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ---------------------------------------------------------------------------
# CORS — media バケットは直接 PUT (S3 presigned URL) の対象
# ---------------------------------------------------------------------------

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.this["media"].id

  cors_rule {
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"] # CloudFront 経由配信なので GET は広めで許容
    allowed_headers = []
    max_age_seconds = 3600
  }

  cors_rule {
    id              = "presigned-upload"
    allowed_methods = ["PUT", "POST"]
    # フロントエンドの origin のみ。Phase 0.5-07 の stg 環境で上書きする。
    allowed_origins = ["https://stg.*"] # 仮、edge モジュール導入時に上書き
    allowed_headers = ["Content-Type", "Content-MD5", "x-amz-*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3600
  }
}

# ---------------------------------------------------------------------------
# Bucket policy for CloudFront OAC (media / static)
# - cloudfront_oac_arn が空なら policy を作らない (edge モジュール未導入時)
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "cloudfront_read" {
  for_each = var.cloudfront_oac_arn == "" ? {} : { media = true, static = true }

  statement {
    sid     = "AllowCloudFrontServicePrincipalRead"
    effect  = "Allow"
    actions = ["s3:GetObject"]

    resources = ["${aws_s3_bucket.this[each.key].arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [var.cloudfront_oac_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudfront_read" {
  for_each = data.aws_iam_policy_document.cloudfront_read

  bucket = aws_s3_bucket.this[each.key].id
  policy = each.value.json
}
