#####################################################################
# ECS Task Definitions + Services for Phase 1 stg deployment.
#
# Phase 1 完了後 (PR #196) の stg 起動に必要な最小構成:
#   - django (Gunicorn, ALB target group=app)
#   - next   (Next.js SSR, ALB target group=next)
#   - celery-worker
#   - celery-beat
#   - django-migrate (one-shot Fargate task, cd-stg.yml が run-task で起動)
#
# Daphne (Channels / DM) は Phase 3 で別途追加。Daphne 用 ALB target group は
# compute モジュールに既に存在するが、本モジュールでは task def を作らない。
#
# 設計方針:
#   - 1 task = 1 container が原則。Sidecar (xray-agent / log-router 等) は
#     phase 9 本番昇格時に検討。
#   - Secrets Manager の秘密は ECS task definition の `secrets` で注入する
#     (環境変数として container に到達するが、CloudTrail に値が残らない)。
#   - すべて FARGATE (FARGATE_SPOT は celery-worker のみ将来採用)。
#####################################################################

locals {
  prefix = "${var.project}-${var.environment}"
  common_tags = merge(var.tags, {
    Module = "services"
  })

  # 全アプリで共有する非機密 env (CloudWatch metric / logging 用 ARG 含む)
  common_env = [
    { name = "DJANGO_SETTINGS_MODULE", value = "config.settings.production" },
    { name = "SENTRY_ENVIRONMENT", value = var.environment },
    { name = "DOMAIN", value = var.domain },
    { name = "AWS_REGION", value = var.aws_region },
    { name = "POSTGRES_HOST", value = var.rds_endpoint },
    { name = "POSTGRES_PORT", value = "5432" },
    { name = "POSTGRES_DB", value = var.rds_database_name },
    { name = "POSTGRES_USER", value = var.rds_username },
    # RDS が pg_hba.conf で暗号化接続のみ受け付けるため libpq 環境変数で SSL 強制
    { name = "PGSSLMODE", value = "require" },
    { name = "REDIS_URL", value = var.redis_url_template },
    { name = "CELERY_BROKER_URL", value = var.redis_url_template },
    { name = "CELERY_RESULT_BACKEND", value = var.redis_url_template },
    { name = "DJANGO_ADMIN_URL", value = "admin/" },
    { name = "COOKIE_SECURE", value = "True" },
    { name = "CORS_ALLOWED_ORIGINS", value = var.cors_allowed_origins },
    { name = "ALLOWED_HOSTS", value = var.domain },
  ]

  # Django / Celery 共通の機密注入。ARN を直接 secrets ブロックに渡す。
  # NOTE: Sentry DSN / Google OAuth / Mailgun はハルナさん側で実値を put-secret-value
  # するまで placeholder 値 (`{"value":"SET_VIA_AWS_CLI..."}`) のまま。これを env に
  # 注入すると Sentry init で `BadDsn: Unsupported scheme ''` で起動失敗するため、
  # 実値が put される時点で services モジュールに追加し直す方針に変更。
  # それまでは Required な secrets のみ注入する。
  django_secrets = [
    { name = "DJANGO_SECRET_KEY", valueFrom = var.secret_arns["django/secret-key"] },
    { name = "SIGNING_KEY", valueFrom = var.secret_arns["django/jwt-signing-key"] },
    { name = "POSTGRES_PASSWORD", valueFrom = var.secret_arns["django/db-password"] },
    { name = "REDIS_AUTH_TOKEN", valueFrom = var.secret_arns["redis/auth-token"] },
  ]

  # Next.js (SSR) は public NEXT_PUBLIC_* のみ。Sentry DSN は build-time に build args
  # で渡す (cd-stg.yml で secrets.NEXT_PUBLIC_SENTRY_DSN を指定済)。
  next_secrets = []
}

#####################################################################
# CloudWatch Log Groups
#
# observability モジュールが既に django/next/celery-worker/celery-beat/daphne
# 用の log group を管理しているため、services モジュールでは観測対象外の
# django-migrate (one-shot job) のみを作成する。task definition の
# logConfiguration は文字列で `/ecs/${prefix}/<svc>` を参照する (observability
# 側と命名規約が同じであること前提)。
#####################################################################
resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.prefix}/django-migrate"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

locals {
  log_group_names = {
    "django"         = "/ecs/${local.prefix}/django"
    "next"           = "/ecs/${local.prefix}/next"
    "celery-worker"  = "/ecs/${local.prefix}/celery-worker"
    "celery-beat"    = "/ecs/${local.prefix}/celery-beat"
    "django-migrate" = aws_cloudwatch_log_group.migrate.name
  }
}

#####################################################################
# IAM: Secrets Manager 読み取り policy を task execution role に attach
# (アプリ container が secrets ブロック経由で値を取れるようにする)
#####################################################################
data "aws_iam_policy_document" "secrets_read" {
  statement {
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]
    resources = values(var.secret_arns)
  }
}

resource "aws_iam_policy" "secrets_read" {
  name        = "${local.prefix}-ecs-secrets-read"
  description = "ECS task execution role に attach する Secrets Manager 読み取り権限"
  policy      = data.aws_iam_policy_document.secrets_read.json
  tags        = local.common_tags
}

resource "aws_iam_role_policy_attachment" "exec_secrets" {
  role       = var.ecs_task_execution_role_name
  policy_arn = aws_iam_policy.secrets_read.arn
}

#####################################################################
# Task Definitions
#####################################################################

# ---------- django (Gunicorn API) ----------
resource "aws_ecs_task_definition" "django" {
  family                   = "${local.prefix}-django"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.django_cpu
  memory                   = var.django_memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "django"
      image     = "${var.ecr_repository_urls["django"]}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 8000, protocol = "tcp" }
      ]
      environment = local.common_env
      secrets     = local.django_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_names["django"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "django"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsSL http://localhost:8000/api/health/ || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = local.common_tags
}

# ---------- next (Next.js SSR) ----------
resource "aws_ecs_task_definition" "next" {
  family                   = "${local.prefix}-next"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.next_cpu
  memory                   = var.next_memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name      = "next"
      image     = "${var.ecr_repository_urls["next"]}:${var.image_tag}"
      essential = true
      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "NEXT_PUBLIC_API_BASE_URL", value = "https://${var.domain}/api/v1" },
        { name = "PORT", value = "3000" },
      ]
      secrets = local.next_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_names["next"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "next"
        }
      }
    }
  ])

  tags = local.common_tags
}

# ---------- celery-worker ----------
resource "aws_ecs_task_definition" "celery_worker" {
  family                   = "${local.prefix}-celery-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.celery_cpu
  memory                   = var.celery_memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name        = "celery-worker"
      image       = "${var.ecr_repository_urls["django"]}:${var.image_tag}" # Django image を共有
      essential   = true
      command     = ["celery", "-A", "config", "worker", "-l", "INFO"]
      environment = local.common_env
      secrets     = local.django_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_names["celery-worker"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "celery"
        }
      }
    }
  ])

  tags = local.common_tags
}

# ---------- celery-beat (must be Single Instance!) ----------
resource "aws_ecs_task_definition" "celery_beat" {
  family                   = "${local.prefix}-celery-beat"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.celery_cpu
  memory                   = var.celery_memory
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name        = "celery-beat"
      image       = "${var.ecr_repository_urls["django"]}:${var.image_tag}"
      essential   = true
      command     = ["celery", "-A", "config", "beat", "-l", "INFO", "--scheduler", "django_celery_beat.schedulers:DatabaseScheduler"]
      environment = local.common_env
      secrets     = local.django_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_names["celery-beat"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "beat"
        }
      }
    }
  ])

  tags = local.common_tags
}

# ---------- django-migrate (one-shot, cd-stg.yml run-task) ----------
resource "aws_ecs_task_definition" "django_migrate" {
  family                   = "${local.prefix}-django-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = var.ecs_task_execution_role_arn
  task_role_arn            = var.ecs_task_role_arn

  container_definitions = jsonencode([
    {
      name        = "django"
      image       = "${var.ecr_repository_urls["django"]}:${var.image_tag}"
      essential   = true
      command     = ["python", "manage.py", "migrate", "--noinput"]
      environment = local.common_env
      secrets     = local.django_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_names["django-migrate"]
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "migrate"
        }
      }
    }
  ])

  tags = local.common_tags
}

#####################################################################
# ECS Services
#####################################################################

# django (ALB target group=app, port 8000)
resource "aws_ecs_service" "django" {
  name             = "${local.prefix}-django"
  cluster          = var.ecs_cluster_arn
  task_definition  = aws_ecs_task_definition.django.arn
  desired_count    = var.django_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arns["app"]
    container_name   = "django"
    container_port   = 8000
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  # cd-stg.yml が `force-new-deployment` で更新するため、image tag 変更で
  # terraform plan に毎回差分が出ないよう、task_definition revision の管理は
  # CD 側に委譲する。`ignore_changes` で revision を terraform 監視外に。
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}

# next (ALB target group=next, port 3000)
resource "aws_ecs_service" "next" {
  name             = "${local.prefix}-next"
  cluster          = var.ecs_cluster_arn
  task_definition  = aws_ecs_task_definition.next.arn
  desired_count    = var.next_desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arns["next"]
    container_name   = "next"
    container_port   = 3000
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}

# celery-worker (no ALB)
resource "aws_ecs_service" "celery_worker" {
  name             = "${local.prefix}-celery-worker"
  cluster          = var.ecs_cluster_arn
  task_definition  = aws_ecs_task_definition.celery_worker.arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}

# celery-beat (must be 1 task only — duplicates cause double scheduling)
resource "aws_ecs_service" "celery_beat" {
  name             = "${local.prefix}-celery-beat"
  cluster          = var.ecs_cluster_arn
  task_definition  = aws_ecs_task_definition.celery_beat.arn
  desired_count    = 1
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = false
  }

  # Beat は重複起動禁止。max=100 で「新タスク開始前に古いタスク停止」を強制。
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  tags = local.common_tags
}
