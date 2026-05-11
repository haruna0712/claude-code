# stg environment composition (P0.5-07).
#
# 7 モジュールを結合して stg 環境を立ち上げる。`terraform apply` 一回で
# 全リソースが起動する状態を目指す (ECS task definition / aws_ecs_service は
# Hello World 相当を P0.5-11 / P0.5-12 で追加する)。
#
# モジュール呼び出し順 (実質的な依存):
#   secrets (独立)
#   network (独立) ────┬──▶ data (network の subnet / sg を受ける)
#                      │
#                      └──▶ storage (ほぼ独立、edge の OAC を後で受ける)
#   edge (ALB DNS を受ける必要があるので compute の後)
#   compute (network / (後から) edge の ACM を受ける)
#   observability (compute / data / (後から) edge を識別子で参照)
#
# 循環を避けるため、edge の OAC を storage に渡すのは第二フェーズで行う
# (最初は OAC なしで storage を作り、edge 作成後に bucket policy を付ける)。
# stg はまだサービスを公開していないので、この二段階運用は Phase 0.5 では許容。

locals {
  project = var.project

  common_tags = {
    Project     = var.project
    Environment = "stg"
    ManagedBy   = "terraform"
  }
}

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# 1. Secrets Manager
# ---------------------------------------------------------------------------

module "secrets" {
  source = "../../modules/secrets"

  environment             = "stg"
  project                 = var.project
  recovery_window_in_days = 7 # stg
  generate_random_values  = true
}

# ---------------------------------------------------------------------------
# 2. Network (VPC / subnets / SG / fck-nat / VPC endpoints)
# ---------------------------------------------------------------------------

module "network" {
  source = "../../modules/network"

  environment          = "stg"
  project              = var.project
  enable_vpc_endpoints = var.enable_vpc_endpoints
}

# ---------------------------------------------------------------------------
# 3. Data (RDS + ElastiCache)
# ---------------------------------------------------------------------------

module "data" {
  source = "../../modules/data"

  environment = "stg"
  project     = var.project

  db_subnet_ids           = module.network.db_subnet_ids
  rds_security_group_id   = module.network.rds_security_group_id
  redis_security_group_id = module.network.redis_security_group_id

  db_master_password = module.secrets.db_password_value

  rds_instance_class               = var.rds_instance_class
  rds_allocated_storage_gb         = var.rds_allocated_storage_gb
  rds_multi_az                     = var.rds_multi_az
  rds_skip_final_snapshot          = var.rds_skip_final_snapshot
  rds_deletion_protection          = var.rds_deletion_protection
  final_snapshot_identifier_suffix = var.final_snapshot_identifier_suffix

  redis_node_type  = var.redis_node_type
  redis_auth_token = module.secrets.redis_auth_token_value
}

# ---------------------------------------------------------------------------
# 4. Storage (S3 buckets)
# 最初は OAC なしで作成。edge 作成後に bucket policy を足すため、
# 本環境では `cloudfront_oac_arn` は 2 度目の apply で埋める想定
# (chicken-and-egg を許容)。
# ---------------------------------------------------------------------------

module "storage" {
  source = "../../modules/storage"

  environment = "stg"
  project     = var.project

  aws_account_id   = data.aws_caller_identity.current.account_id
  frontend_origins = ["https://${var.app_subdomain}.${var.domain_name}"]

  # 二段階 apply (architect PR #53 HIGH): 初回は空、edge 作成後に tfvars で
  # `cloudfront_distribution_arn_override` を埋めて再 apply。
  cloudfront_oac_arn = var.cloudfront_distribution_arn_override

  # DM 添付の lifecycle (P3-07 / Issue #232)。stg は default 値 (90/365) で運用想定だが、
  # 必要に応じて terraform.tfvars で上書き可能にする。
  dm_attachment_glacier_ir_days = var.dm_attachment_glacier_ir_days
  dm_attachment_expiration_days = var.dm_attachment_expiration_days
}

# ---------------------------------------------------------------------------
# 5. Compute (ECS + ALB + ECR + IAM)
# HTTPS listener は edge 作成後 (ACM ARN 渡し) に enable されるため、
# 初回 apply は HTTP のみで ALB を起動する二段階運用。
# ---------------------------------------------------------------------------

module "compute" {
  source = "../../modules/compute"

  environment = "stg"
  project     = var.project

  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  alb_security_group_id = module.network.alb_security_group_id

  # edge 作成後に acm_alb_arn を渡す (二段階 apply、architect PR #53 HIGH)。
  # 最初の apply は空文字列 = HTTP only で ALB を起動。
  alb_certificate_arn = var.alb_certificate_arn_override

  alb_idle_timeout_seconds = 3600
  enable_fargate_spot      = true

  # F-02: ALB access logs を storage の専用バケットに書き出す。
  # prefix は compute モジュール側で "alb/<env>" 固定。
  alb_access_logs_bucket = module.storage.alb_logs_bucket_id
}

# ---------------------------------------------------------------------------
# 6. Edge (CloudFront + Route53 + ACM)
# ---------------------------------------------------------------------------

module "edge" {
  source = "../../modules/edge"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  environment = "stg"
  project     = var.project

  domain_name       = var.domain_name
  app_subdomain     = var.app_subdomain
  webhook_subdomain = var.webhook_subdomain

  alb_dns_name = module.compute.alb_dns_name
  alb_zone_id  = module.compute.alb_zone_id

  media_bucket_regional_domain  = module.storage.bucket_regional_domains["media"]
  static_bucket_regional_domain = module.storage.bucket_regional_domains["static"]

  enable_waf              = var.enable_waf
  waf_rate_limit_per_5min = var.waf_rate_limit_per_5min
}

# ---------------------------------------------------------------------------
# 6.4. HTTP listener rules (stg 暫定 — DNS 委任後に削除予定)
# ---------------------------------------------------------------------------
# edge モジュール (HTTPS listener を作る) は DNS 委任完了が前提のため、それまで
# ECS service が target group を associate できない。stg では暫定的に HTTP:80 に
# forward rule を追加して target group を LB に紐付ける。

data "aws_lb_listener" "stg_http" {
  load_balancer_arn = module.compute.alb_arn
  port              = 80
}

resource "aws_lb_listener_rule" "stg_http_api" {
  listener_arn = data.aws_lb_listener.stg_http.arn
  priority     = 10
  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = module.compute.target_group_arns["app"]
  }
}

resource "aws_lb_listener_rule" "stg_http_default" {
  listener_arn = data.aws_lb_listener.stg_http.arn
  priority     = 100
  condition {
    path_pattern {
      values = ["/*"]
    }
  }
  action {
    type             = "forward"
    target_group_arn = module.compute.target_group_arns["next"]
  }
}

# ---------------------------------------------------------------------------
# 6.5. ECS Services (Phase 1 stg deployment)
# ---------------------------------------------------------------------------
#
# Phase 1 完了後の stg 起動に必要な ECS task definition + service を追加する。
# F1-2 で cd-stg.yml の placeholder を本実装に切替えたが、その実装が機能する
# ために必要な ECS resource をここで作成する。
#
# 含まれる: django / next / celery-worker / celery-beat の 4 service +
#          django-migrate (one-shot task definition)。
# 含まれない: daphne (Phase 3 DM 実装と同時に追加)。

module "services" {
  source = "../../modules/services"

  project     = var.project
  environment = "stg"
  aws_region  = "ap-northeast-1"

  # compute モジュールから受け取る
  ecs_cluster_arn              = module.compute.ecs_cluster_arn
  ecs_task_execution_role_arn  = module.compute.ecs_task_execution_role_arn
  ecs_task_execution_role_name = module.compute.ecs_task_execution_role_name
  ecs_task_role_arn            = module.compute.ecs_task_role_arn
  ecs_task_role_name           = module.compute.ecs_task_role_name
  # compute モジュールの ECR repos は infra 観点 (backend/frontend/nginx) で命名されているが、
  # services モジュールはアプリ観点 (django/next) で参照したい。ここで rename map を作る。
  ecr_repository_urls = {
    django = module.compute.ecr_repository_urls["backend"]
    next   = module.compute.ecr_repository_urls["frontend"]
  }
  target_group_arns = module.compute.target_group_arns

  # network モジュールから
  private_subnet_ids    = module.network.private_subnet_ids
  ecs_security_group_id = module.network.ecs_security_group_id

  # secrets モジュールから (path → ARN map)
  secret_arns = module.secrets.secret_arns

  # data モジュールから (rds_endpoint は host:port 形式なので port なしの rds_address を渡す)
  rds_endpoint       = module.data.rds_address
  redis_url_template = module.data.redis_connection_url

  # アプリ config
  domain               = "${var.app_subdomain}.${var.domain_name}"
  cors_allowed_origins = "https://${var.app_subdomain}.${var.domain_name}"
  media_bucket_name    = module.storage.media_bucket_id
  media_public_domain  = "${var.app_subdomain}.${var.domain_name}"
  static_bucket_name   = module.storage.static_bucket_id
  app_fqdn             = "${var.app_subdomain}.${var.domain_name}"

  # SSR fetch base URL (Next → Django via ALB internal lookup)
  alb_dns_name = module.compute.alb_dns_name

  tags = local.common_tags
}

# ---------------------------------------------------------------------------
# 6.6. GitHub Actions OIDC (cd-stg.yml の AWS 認証用)
# ---------------------------------------------------------------------------

module "github_oidc" {
  source = "../../modules/github_oidc"

  environment  = "stg"
  project      = var.project
  github_owner = "haruna0712"
  github_repo  = "claude-code"
  # main push のみ stg デプロイ許可
  allowed_refs = [
    "repo:haruna0712/claude-code:ref:refs/heads/main",
  ]

  # ECR push (build job)
  ecr_repository_arns = values(module.compute.ecr_repository_arns)

  # ECS update-service / run-task (deploy / migrate jobs)
  ecs_cluster_arn = module.compute.ecs_cluster_arn

  # iam:PassRole for task definition's execution_role / task_role
  ecs_task_role_arns = [
    module.compute.ecs_task_execution_role_arn,
    module.compute.ecs_task_role_arn,
  ]

  # Secrets Manager (cd-stg は describe で revision 確認等に使う)
  # detect-secrets が "secret:" を秘密情報と誤検知するため allowlist。実体は ARN prefix のみ。
  secrets_arn_prefix = "arn:aws:secretsmanager:ap-northeast-1:${data.aws_caller_identity.current.account_id}:secret:sns/stg/*" # pragma: allowlist secret
}

# ---------------------------------------------------------------------------
# 7. Observability (Log Groups + Alarms + SNS Topic)
# ---------------------------------------------------------------------------

module "observability" {
  source = "../../modules/observability"

  environment        = "stg"
  project            = var.project
  aws_region         = var.aws_region
  log_retention_days = 30
  alert_email        = var.alert_email

  ecs_services = ["django", "next", "daphne", "celery-worker", "celery-beat"]

  # compute モジュールが `service_names` output で実サービス名を返す。
  ecs_service_name_map = module.compute.service_names
  ecs_cluster_name     = module.compute.ecs_cluster_name

  alb_arn_suffix    = module.compute.alb_arn_suffix
  enable_alb_alarms = true

  rds_instance_identifier  = module.data.rds_instance_id
  rds_allocated_storage_gb = var.rds_allocated_storage_gb
  enable_rds_alarms        = true

  # P3-18 / Issue #243: DM 関連メトリクス & アラーム + Dashboard
  enable_dm_alarms               = true
  daphne_target_group_arn_suffix = module.compute.target_group_arn_suffixes["daphne"]
  redis_replication_group_id     = module.data.redis_id
}

# ---------------------------------------------------------------------------
# 8. DM 添付の S3 直アップロード権限 (P3-07 / Issue #232)
# ---------------------------------------------------------------------------
# storage <-> compute の循環参照を避けるため、両モジュール作成後に
# stg レイヤで直接 IAM role policy を attach する:
#   - PutObject  : presigned URL 経由のアップロード
#   - GetObject  : 添付ダウンロード (ヘッド確認 + ファイルサイズ確認、SPEC §7)
#   - DeleteObject : メッセージ削除時のオブジェクト削除 (SPEC §7.3、24h 削除キュー)
# avatar/header は users/*、DM添付は dm/*、 記事内画像は article-images/*、
# collectstatic は static bucket の static/* prefix に限定する。
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "ecs_dm_attachment_access" {
  # オブジェクトレベル: presigned upload/download に必要な権限を prefix 限定で許可。
  # GetObjectVersion は versioning ON のバケットで HEAD/GET が誤って 404 になる事象を
  # 避けるため (security-reviewer HIGH-1: AWS は ListBucket なしの場合 NoSuchKey 扱い)。
  statement {
    sid    = "AllowPresignedMediaObjectAccessStg"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:DeleteObject",
    ]
    resources = [
      "${module.storage.media_bucket_arn}/dm/*",
      "${module.storage.media_bucket_arn}/users/*",
      # 記事内画像 (apps.articles.s3_presign で発行する key 形式
      # `article-images/<user_id>/<uuid>.<ext>`、 P6-04 PR #591)。
      # 当初は `articles/` prefix を使っていたが、 Next.js の 2 階層 page
      # (`/articles/me/drafts` `/articles/<slug>/edit`) と CloudFront path_pattern
      # が衝突したため、 prefix を `article-images/` に分離した (2026-05-11)。
      "${module.storage.media_bucket_arn}/article-images/*",
    ]
  }

  # バケットレベル ListBucket: media upload prefix 限定で許可
  # (security-reviewer HIGH-1: ListBucket がないと Glacier IR 復元時等に 404 誤判定)。
  statement {
    sid       = "AllowPresignedMediaListStg"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.media_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values = [
        "dm/*", "dm/", "dm",
        "users/*", "users/", "users",
        "article-images/*", "article-images/", "article-images",
      ]
    }
  }

  # バケットレベル GetBucketLocation: SDK がリクエスト署名のリージョン解決に
  # 暗黙発行する。s3:prefix 条件は GetBucketLocation に適用されないため別 statement。
  statement {
    sid       = "AllowDMAttachmentBucketLocationStg"
    effect    = "Allow"
    actions   = ["s3:GetBucketLocation"]
    resources = [module.storage.media_bucket_arn]
  }
}

data "aws_iam_policy_document" "ecs_static_collectstatic_access" {
  statement {
    sid    = "AllowStaticCollectObjectAccessStg"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:DeleteObject",
    ]
    resources = ["${module.storage.static_bucket_arn}/static/*"]
  }

  statement {
    sid       = "AllowStaticCollectListStg"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [module.storage.static_bucket_arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["static/*", "static/", "static"]
    }
  }

  statement {
    sid       = "AllowStaticBucketLocationStg"
    effect    = "Allow"
    actions   = ["s3:GetBucketLocation"]
    resources = [module.storage.static_bucket_arn]
  }
}

resource "aws_iam_role_policy" "ecs_dm_attachment" {
  name   = "${var.project}-stg-ecs-presigned-media"
  role   = module.compute.ecs_task_role_name
  policy = data.aws_iam_policy_document.ecs_dm_attachment_access.json
}

resource "aws_iam_role_policy" "ecs_static_collectstatic" {
  name   = "${var.project}-stg-ecs-static-collectstatic"
  role   = module.compute.ecs_task_role_name
  policy = data.aws_iam_policy_document.ecs_static_collectstatic_access.json
}
