# Observability module (P0.5-06)
#
# CloudWatch Log Groups + CloudWatch Alarms + SNS Topic for alerts.
# 他モジュール (compute/data/edge) はこのモジュールの出力を参照せず、
# このモジュールが他モジュールのリソース名を var で受け取る片方向依存にする
# (architect 推奨: モジュール間の output 引き回しコスト削減)。

locals {
  prefix = "${var.project}-${var.environment}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "observability"
    },
    var.tags,
  )

  # ECS サービス論理名 -> 実 ServiceName を解決する。
  # caller が map で明示した場合はそちらを優先し、それ以外は prefix+論理名で推定。
  resolved_ecs_service_names = {
    for logical in var.ecs_services :
    logical => lookup(var.ecs_service_name_map, logical, "${local.prefix}-${logical}")
  }

  # RDS FreeStorageSpace 閾値 (bytes) = allocated_storage * (1 - ratio)
  # 例: 20GB × 0.2 = 4GB、100GB × 0.2 = 20GB
  rds_free_storage_threshold_bytes = floor(
    var.rds_allocated_storage_gb * var.rds_free_storage_threshold_ratio * 1024 * 1024 * 1024
  )
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups — 1 ECS サービスにつき 1 group
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "ecs" {
  for_each = toset(var.ecs_services)

  name              = "/ecs/${local.prefix}/${each.value}"
  retention_in_days = var.log_retention_days

  tags = merge(local.default_tags, { Service = each.value })
}

# ---------------------------------------------------------------------------
# SNS Topic — アラート配信先
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name = "${local.prefix}-alerts"
  tags = local.default_tags
}

resource "aws_sns_topic_subscription" "alert_email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# ECS Service CPU Alarm (1 サービスにつき 1 アラーム)
# ecs_cluster_name が未指定のうちは作らない。
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "ecs_service_cpu" {
  for_each = var.ecs_cluster_name == "" ? toset([]) : toset(var.ecs_services)

  alarm_name          = "${local.prefix}-ecs-${each.value}-cpu-high"
  alarm_description   = "ECS service ${each.value} CPU > 80% for 15 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300 # 5min
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = var.ecs_cluster_name
    # 実 ServiceName は var.ecs_service_name_map で明示注入可能 (architect PR #46 HIGH)。
    # 未指定時は "<prefix>-<logical>" にフォールバックする。
    ServiceName = local.resolved_ecs_service_names[each.value]
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.default_tags, { Service = each.value })
}

# ---------------------------------------------------------------------------
# RDS CPU / FreeStorageSpace Alarms
# `enable_rds_alarms` で作成可否を切り替える。
#
# NOTE: 当初 `count = var.rds_instance_identifier == "" ? 0 : 1` だったが、
# `var.rds_instance_identifier` が module.data の output (= apply 時に決まる)
# のため plan 時に "Invalid count argument" になる。`for_each = ... == "" ? ...`
# でも同じく Terraform は値が unknown なら for_each set を確定できないと判断
# してエラーにする。caller 側で「アラームを作る/作らない」を静的に判断する
# `enable_rds_alarms` (bool) を別変数として渡すのが Terraform 推奨パターン。
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  for_each = var.enable_rds_alarms ? toset(["this"]) : toset([])

  alarm_name          = "${local.prefix}-rds-cpu-high"
  alarm_description   = "RDS CPU > 80% for 15 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.default_tags
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  for_each = var.enable_rds_alarms ? toset(["this"]) : toset([])

  alarm_name          = "${local.prefix}-rds-storage-low"
  alarm_description   = "RDS FreeStorageSpace < ${floor(var.rds_free_storage_threshold_ratio * 100)}% of ${var.rds_allocated_storage_gb}GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = local.rds_free_storage_threshold_bytes
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_identifier
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.default_tags
}

# ---------------------------------------------------------------------------
# ALB 5xx Error Rate Alarm
# alb_arn_suffix が未指定なら作らない。
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "alb_5xx_rate" {
  for_each = var.enable_alb_alarms ? toset(["this"]) : toset([])

  alarm_name          = "${local.prefix}-alb-5xx-rate-high"
  alarm_description   = "ALB HTTPCode_Target_5XX_Count > 1% of total requests"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 0.01
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "error_rate"
    expression  = "IF(total_requests > 0, errors_5xx / total_requests, 0)"
    label       = "5xx error rate"
    return_data = true
  }

  metric_query {
    id = "errors_5xx"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
      }
    }
  }

  metric_query {
    id = "total_requests"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
      }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = local.default_tags
}

# ---------------------------------------------------------------------------
# P3-18 / Issue #243: DM 関連アラーム
# - /ws/* (daphne TG) の 5xx error rate
# - ElastiCache Redis (Channel layer) の CurrConnections / EngineCPUUtilization
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "daphne_5xx_rate" {
  # for_each guard は静的 bool のみで条件付ける (code-reviewer HIGH H-2 反映)。
  # arn_suffix は module.compute の output で apply 時 unknown になるため、
  # `!= ""` 条件を for_each に入れると plan 時に key set が確定せずエラーになる。
  for_each = var.enable_dm_alarms ? toset(["this"]) : toset([])

  alarm_name = "${local.prefix}-daphne-5xx-rate-high"
  alarm_description = format(
    "/ws/* (daphne TG) HTTPCode_Target_5XX_Count > %.1f%% over 5min (minimum 10 req/period)",
    var.daphne_5xx_error_rate_threshold * 100,
  )
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = var.daphne_5xx_error_rate_threshold
  treat_missing_data  = "notBreaching"

  # architect HIGH H-1 反映: 低 traffic 時 (total < 10) は分母が小さく 1 件のエラーで
  # 50% を超えてしまい false positive になる。最低 10 req/period のガードを入れる。
  metric_query {
    id          = "error_rate"
    expression  = "IF(total > 10, errors / total, 0)"
    label       = "/ws/* 5xx error rate (gated by min traffic)"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "HTTPCode_Target_5XX_Count"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.daphne_target_group_arn_suffix
      }
    }
  }

  metric_query {
    id = "total"
    metric {
      metric_name = "RequestCount"
      namespace   = "AWS/ApplicationELB"
      period      = 300
      stat        = "Sum"
      dimensions = {
        LoadBalancer = var.alb_arn_suffix
        TargetGroup  = var.daphne_target_group_arn_suffix
      }
    }
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.default_tags, { Service = "daphne" })
}

resource "aws_cloudwatch_metric_alarm" "redis_curr_connections" {
  # for_each は静的 bool のみ (code-reviewer HIGH H-2 反映、apply-time unknown 回避)
  for_each = var.enable_dm_alarms ? toset(["this"]) : toset([])

  alarm_name          = "${local.prefix}-redis-curr-connections-high"
  alarm_description   = "Channel layer Redis CurrConnections > ${var.redis_curr_connections_threshold} (>5min)"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CurrConnections"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = var.redis_curr_connections_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = var.redis_replication_group_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.default_tags, { Service = "redis" })
}

resource "aws_cloudwatch_metric_alarm" "redis_engine_cpu" {
  # for_each は静的 bool のみ (code-reviewer HIGH H-2 反映、apply-time unknown 回避)
  for_each = var.enable_dm_alarms ? toset(["this"]) : toset([])

  alarm_name          = "${local.prefix}-redis-engine-cpu-high"
  alarm_description   = "Channel layer Redis EngineCPUUtilization > ${var.redis_engine_cpu_threshold}% over 5min"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = var.redis_engine_cpu_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = var.redis_replication_group_id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = merge(local.default_tags, { Service = "redis" })
}

# ---------------------------------------------------------------------------
# DM Dashboard (P3-18)
# Daphne / /ws/* / Redis を 1 画面で確認できる CloudWatch Dashboard。
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "dm" {
  count = var.enable_dm_alarms ? 1 : 0

  dashboard_name = "${local.prefix}-dm"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Daphne ECS — CPU / Memory"
          region  = var.aws_region
          view    = "timeSeries"
          stacked = false
          # ecs_services に "daphne" が含まれない呼び出し方への保険として lookup + 空文字列。
          metrics = [
            ["AWS/ECS", "CPUUtilization", "ClusterName", var.ecs_cluster_name, "ServiceName", lookup(local.resolved_ecs_service_names, "daphne", ""), { stat = "Average" }],
            [".", "MemoryUtilization", ".", ".", ".", ".", { stat = "Average" }],
          ]
          period = 60
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "/ws/* (daphne TG) — 5xx / Requests / TargetResponseTime"
          region  = var.aws_region
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", var.alb_arn_suffix, "TargetGroup", var.daphne_target_group_arn_suffix, { stat = "Sum" }],
            [".", "RequestCount", ".", ".", ".", ".", { stat = "Sum" }],
            [".", "TargetResponseTime", ".", ".", ".", ".", { stat = "p95" }],
          ]
          period = 60
          annotations = {
            horizontal = [
              { value = var.daphne_5xx_error_rate_threshold, label = "5xx rate alarm threshold (ratio)", color = "#d62728" },
            ]
          }
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          title   = "Channel layer Redis — CurrConnections / EngineCPUUtilization"
          region  = var.aws_region
          view    = "timeSeries"
          stacked = false
          metrics = [
            ["AWS/ElastiCache", "CurrConnections", "ReplicationGroupId", var.redis_replication_group_id, { stat = "Average" }],
            [".", "EngineCPUUtilization", ".", ".", { stat = "Average" }],
          ]
          period = 60
          annotations = {
            horizontal = [
              { value = var.redis_curr_connections_threshold, label = "CurrConnections alarm threshold", color = "#d62728" },
              { value = var.redis_engine_cpu_threshold, label = "EngineCPU alarm threshold", color = "#ff9896" },
            ]
          }
        }
      },
    ]
  })
}
