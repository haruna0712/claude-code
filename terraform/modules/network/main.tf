# Network module (P0.5-02)
#
# 責務:
#   - VPC + subnets (public / private / db × 2 AZ)
#   - IGW + Route Tables
#   - Security Groups (alb / ecs / rds / redis / fcknat)
#   - fck-nat ASG (Auto Scaling Group で自己復旧する NAT Instance 代替)
#   - VPC Interface Endpoints (ECR / Secrets / Logs / STS) + S3 Gateway Endpoint
#
# stg は Single-AZ 運用だが、AZ a/c 両方にサブネットを切っておき prod 昇格時に
# Multi-AZ へスイッチできるようにする (ARCHITECTURE.md §2)。

locals {
  prefix = "${var.project}-${var.environment}"

  default_tags = merge(
    {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Module      = "network"
    },
    var.tags,
  )

  az_count = length(var.availability_zones)
}

# ---------------------------------------------------------------------------
# VPC + IGW
# ---------------------------------------------------------------------------

resource "aws_vpc" "this" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.default_tags, { Name = "${local.prefix}-vpc" })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.default_tags, { Name = "${local.prefix}-igw" })
}

# ---------------------------------------------------------------------------
# Subnets
# ---------------------------------------------------------------------------

resource "aws_subnet" "public" {
  count = local.az_count

  vpc_id                  = aws_vpc.this.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false # ALB は ENI で public IP を持つので、サブネット既定は false

  tags = merge(local.default_tags, {
    Name = "${local.prefix}-public-${substr(var.availability_zones[count.index], -2, 2)}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count = local.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = merge(local.default_tags, {
    Name = "${local.prefix}-private-${substr(var.availability_zones[count.index], -2, 2)}"
    Tier = "private"
  })
}

resource "aws_subnet" "db" {
  count = local.az_count

  vpc_id            = aws_vpc.this.id
  cidr_block        = var.db_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = merge(local.default_tags, {
    Name = "${local.prefix}-db-${substr(var.availability_zones[count.index], -2, 2)}"
    Tier = "db"
  })
}

# ---------------------------------------------------------------------------
# Route tables
# ---------------------------------------------------------------------------

# Public: IGW 直結
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-public-rt" })
}

resource "aws_route_table_association" "public" {
  count          = local.az_count
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private: fck-nat 経由で外部 API (Mailgun / Stripe / OpenAI / Claude / GitHub) へ
resource "aws_route_table" "private" {
  count  = local.az_count
  vpc_id = aws_vpc.this.id

  # Phase 0.5 は Single-AZ の fck-nat 1 台だが、Multi-AZ 化までのインタフェースは
  # ここで完結させる。prod で fck-nat を AZ ごとに立てる場合はこのロジックを
  # network_interface_id -> aws_network_interface(for AZ=each.az) に変える。
  route {
    cidr_block           = "0.0.0.0/0"
    network_interface_id = aws_network_interface.fcknat[0].id
  }

  tags = merge(local.default_tags, {
    Name = "${local.prefix}-private-${substr(var.availability_zones[count.index], -2, 2)}-rt"
  })
}

resource "aws_route_table_association" "private" {
  count          = local.az_count
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# DB subnet: 外向き経路なし
resource "aws_route_table" "db" {
  vpc_id = aws_vpc.this.id
  tags   = merge(local.default_tags, { Name = "${local.prefix}-db-rt" })
}

resource "aws_route_table_association" "db" {
  count          = local.az_count
  subnet_id      = aws_subnet.db[count.index].id
  route_table_id = aws_route_table.db.id
}

# ---------------------------------------------------------------------------
# Security Groups
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb-sg"
  description = "ALB inbound 80/443 from internet"
  vpc_id      = aws_vpc.this.id

  # HTTPS
  ingress {
    protocol    = "tcp"
    from_port   = 443
    to_port     = 443
    cidr_blocks = ["0.0.0.0/0"]
  }
  # HTTP -> HTTPS redirect
  ingress {
    protocol    = "tcp"
    from_port   = 80
    to_port     = 80
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-alb-sg" })
}

resource "aws_security_group" "ecs" {
  name        = "${local.prefix}-ecs-sg"
  description = "ECS tasks receive traffic from ALB and reach externals via fck-nat / VPC endpoints"
  vpc_id      = aws_vpc.this.id

  ingress {
    protocol        = "tcp"
    from_port       = 0
    to_port         = 65535
    security_groups = [aws_security_group.alb.id]
    description     = "From ALB (nginx:80 / next:3000 / daphne:8001)"
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-ecs-sg" })
}

resource "aws_security_group" "rds" {
  name        = "${local.prefix}-rds-sg"
  description = "RDS accepts 5432 only from ECS tasks"
  vpc_id      = aws_vpc.this.id

  ingress {
    protocol        = "tcp"
    from_port       = 5432
    to_port         = 5432
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-rds-sg" })
}

resource "aws_security_group" "redis" {
  name        = "${local.prefix}-redis-sg"
  description = "ElastiCache Redis accepts 6379 only from ECS tasks"
  vpc_id      = aws_vpc.this.id

  ingress {
    protocol        = "tcp"
    from_port       = 6379
    to_port         = 6379
    security_groups = [aws_security_group.ecs.id]
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-redis-sg" })
}

resource "aws_security_group" "fcknat" {
  name        = "${local.prefix}-fcknat-sg"
  description = "fck-nat instance SG. Accepts traffic from private subnets, egress anywhere."
  vpc_id      = aws_vpc.this.id

  ingress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = concat(var.private_subnet_cidrs, var.db_subnet_cidrs)
    description = "All protocols from private/db subnets"
  }

  egress {
    protocol    = "-1"
    from_port   = 0
    to_port     = 0
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-fcknat-sg" })
}

resource "aws_security_group" "vpc_endpoints" {
  count = var.enable_vpc_endpoints ? 1 : 0

  name        = "${local.prefix}-vpce-sg"
  description = "VPC Interface Endpoints accept 443 from ECS"
  vpc_id      = aws_vpc.this.id

  ingress {
    protocol        = "tcp"
    from_port       = 443
    to_port         = 443
    security_groups = [aws_security_group.ecs.id]
  }

  tags = merge(local.default_tags, { Name = "${local.prefix}-vpce-sg" })
}

# ---------------------------------------------------------------------------
# fck-nat ASG (NAT Instance 代替、Auto Scaling で自己復旧)
# ---------------------------------------------------------------------------

data "aws_ami" "fck_nat" {
  count = var.fck_nat_ami_id == "" ? 1 : 0

  most_recent = true
  owners      = ["568608671756"] # fck-nat official

  filter {
    name   = "name"
    values = ["fck-nat-al2023-*-arm64-ebs"] # t4g 系 ARM 用
  }
}

locals {
  fck_nat_ami_id = var.fck_nat_ami_id != "" ? var.fck_nat_ami_id : data.aws_ami.fck_nat[0].id
}

resource "aws_network_interface" "fcknat" {
  count = 1 # stg は 1 AZ のみ。prod は AZ 数に拡張。

  subnet_id         = aws_subnet.public[count.index].id
  security_groups   = [aws_security_group.fcknat.id]
  source_dest_check = false # NAT として動作させるため必須

  tags = merge(local.default_tags, { Name = "${local.prefix}-fcknat-eni" })
}

resource "aws_launch_template" "fcknat" {
  name_prefix   = "${local.prefix}-fcknat-"
  image_id      = local.fck_nat_ami_id
  instance_type = var.fck_nat_instance_type

  network_interfaces {
    network_interface_id = aws_network_interface.fcknat[0].id
  }

  metadata_options {
    http_tokens   = "required" # IMDSv2 必須
    http_endpoint = "enabled"
  }

  tag_specifications {
    resource_type = "instance"
    tags          = merge(local.default_tags, { Name = "${local.prefix}-fcknat" })
  }

  tags = local.default_tags
}

resource "aws_autoscaling_group" "fcknat" {
  name                = "${local.prefix}-fcknat-asg"
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1
  vpc_zone_identifier = [aws_subnet.public[0].id]

  launch_template {
    id      = aws_launch_template.fcknat.id
    version = "$Latest"
  }

  # インスタンスにタグは launch_template 側で付与するので、ASG タグは propagate=false
  dynamic "tag" {
    for_each = local.default_tags
    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = false
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# VPC Endpoints
# - Gateway (S3): 無料
# - Interface (ECR / Secrets / Logs / STS): 各 $7/月 → NAT 経由を大幅削減
# ---------------------------------------------------------------------------

resource "aws_vpc_endpoint" "s3" {
  count = var.enable_vpc_endpoints ? 1 : 0

  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = concat(aws_route_table.private[*].id, [aws_route_table.db.id])

  tags = merge(local.default_tags, { Name = "${local.prefix}-vpce-s3" })
}

locals {
  interface_endpoints = var.enable_vpc_endpoints ? [
    "ecr.api",
    "ecr.dkr",
    "secretsmanager",
    "logs",
    "sts",
  ] : []
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(local.interface_endpoints)

  vpc_id              = aws_vpc.this.id
  service_name        = "com.amazonaws.${data.aws_region.current.name}.${each.value}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]
  private_dns_enabled = true

  tags = merge(local.default_tags, { Name = "${local.prefix}-vpce-${replace(each.value, ".", "-")}" })
}

data "aws_region" "current" {}
