terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

resource "random_id" "suffix" {
  byte_length = 4
}

resource "random_password" "sentient_token" {
  length  = 32
  special = false
}

# -------------------------------------------------------------
# 1. NETWORKING (VPC, Subnets, Route Tables, IGW)
# -------------------------------------------------------------
resource "aws_vpc" "sentient_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "sentient-vpc-${var.environment}"
    Application = "SentientFreelancer"
  }
}

resource "aws_internet_gateway" "sentient_igw" {
  vpc_id = aws_vpc.sentient_vpc.id

  tags = {
    Name = "sentient-igw-${var.environment}"
  }
}

resource "aws_subnet" "public_1" {
  vpc_id                  = aws_vpc.sentient_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "${var.aws_region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "sentient-public-1"
  }
}

resource "aws_subnet" "public_2" {
  vpc_id                  = aws_vpc.sentient_vpc.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "${var.aws_region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "sentient-public-2"
  }
}

resource "aws_subnet" "private_1" {
  vpc_id            = aws_vpc.sentient_vpc.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "${var.aws_region}a"

  tags = {
    Name = "sentient-private-1"
  }
}

resource "aws_subnet" "private_2" {
  vpc_id            = aws_vpc.sentient_vpc.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "${var.aws_region}b"

  tags = {
    Name = "sentient-private-2"
  }
}

resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.sentient_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.sentient_igw.id
  }

  tags = {
    Name = "sentient-public-rt"
  }
}

resource "aws_route_table_association" "public_1_assoc" {
  subnet_id      = aws_subnet.public_1.id
  route_table_id = aws_route_table.public_rt.id
}

resource "aws_route_table_association" "public_2_assoc" {
  subnet_id      = aws_subnet.public_2.id
  route_table_id = aws_route_table.public_rt.id
}

# -------------------------------------------------------------
# 2. SECURITY GROUPS
# -------------------------------------------------------------
resource "aws_security_group" "ec2_sg" {
  name        = "sentient-ec2-sg-${var.environment}"
  description = "Security group for Sentient Freelancer EC2 runner"
  vpc_id      = aws_vpc.sentient_vpc.id

  # Inbound API (port 8080)
  ingress {
    description = "Express API port"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Inbound HTTPS (port 443)
  ingress {
    description = "HTTPS ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Inbound SSH (port 22) from admin CIDR
  ingress {
    description = "SSH from authorized CIDR"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  # Outbound All
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "sentient-ec2-sg"
  }
}

resource "aws_security_group" "redis_sg" {
  name        = "sentient-redis-sg-${var.environment}"
  description = "Security group for ElastiCache Redis cluster"
  vpc_id      = aws_vpc.sentient_vpc.id

  ingress {
    description     = "Redis from EC2 runner"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ec2_sg.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# -------------------------------------------------------------
# 3. S3 ARTIFACTS & SNAPSHOTS BUCKET
# -------------------------------------------------------------
resource "aws_s3_bucket" "sentient_artifacts" {
  bucket        = "sentient-artifacts-${random_id.suffix.hex}"
  force_destroy = true

  tags = {
    Name        = "Sentient Artifacts"
    Application = "SentientFreelancer"
  }
}

resource "aws_s3_bucket_versioning" "sentient_artifacts_ver" {
  bucket = aws_s3_bucket.sentient_artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "sentient_artifacts_lifecycle" {
  bucket = aws_s3_bucket.sentient_artifacts.id

  rule {
    id     = "expire-screenshots-90-days"
    status = "Enabled"

    expiration {
      days = 90
    }
  }
}

# -------------------------------------------------------------
# 4. ELASTICACHE REDIS (t3.micro)
# -------------------------------------------------------------
resource "aws_elasticache_subnet_group" "redis_subnet_grp" {
  name       = "sentient-redis-subnets-${random_id.suffix.hex}"
  subnet_ids = [aws_subnet.private_1.id, aws_subnet.private_2.id]
}

resource "aws_elasticache_cluster" "sentient_redis" {
  cluster_id           = "sentient-redis-${random_id.suffix.hex}"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis_subnet_grp.name
  security_group_ids   = [aws_security_group.redis_sg.id]

  tags = {
    Name = "sentient-redis"
  }
}

# -------------------------------------------------------------
# 5. IAM ROLE & POLICIES (SSM, S3, CloudWatch)
# -------------------------------------------------------------
resource "aws_iam_role" "ec2_role" {
  name = "sentient-ec2-role-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_policy" "sentient_policy" {
  name        = "sentient-policy-${var.environment}"
  description = "Policy allowing access to S3 artifacts, SSM parameters, and CloudWatch Logs"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.sentient_artifacts.arn,
          "${aws_s3_bucket.sentient_artifacts.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/sentient/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "sentient_policy_attach" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = aws_iam_policy.sentient_policy.arn
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "sentient-ec2-profile-${var.environment}"
  role = aws_iam_role.ec2_role.name
}

# -------------------------------------------------------------
# 6. SSM PARAMETERS (Secure secrets management)
# -------------------------------------------------------------
resource "aws_ssm_parameter" "sentient_token" {
  name        = "/sentient/token"
  description = "Bearer token for Sentient Freelancer API authentication"
  type        = "SecureString"
  value       = random_password.sentient_token.result
}

resource "aws_ssm_parameter" "allowed_origin" {
  name        = "/sentient/allowed-origin"
  description = "CORS allowed origin for Amplify frontend"
  type        = "String"
  value       = var.allowed_origin
}

resource "aws_ssm_parameter" "redis_url" {
  name        = "/sentient/redis-url"
  description = "Connection URL for ElastiCache Redis"
  type        = "String"
  value       = "redis://${aws_elasticache_cluster.sentient_redis.cache_nodes[0].address}:6379"
}

resource "aws_ssm_parameter" "s3_bucket" {
  name        = "/sentient/s3-bucket"
  description = "Target S3 bucket for artifacts and snapshots"
  type        = "String"
  value       = aws_s3_bucket.sentient_artifacts.bucket
}

# -------------------------------------------------------------
# 7. EC2 RUNNER (t3.medium + Elastic IP)
# -------------------------------------------------------------
data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  owners = ["099720109477"] # Canonical
}

resource "aws_instance" "sentient_runner" {
  ami                  = data.aws_ami.ubuntu.id
  instance_type        = var.instance_type
  subnet_id            = aws_subnet.public_1.id
  vpc_security_group_ids = [aws_security_group.ec2_sg.id]
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name

  root_block_device {
    volume_size = 40
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = file("${path.module}/user_data.sh")

  tags = {
    Name        = "sentient-freelancer-runner"
    Application = "SentientFreelancer"
  }
}

resource "aws_eip" "sentient_eip" {
  instance = aws_instance.sentient_runner.id
  domain   = "vpc"

  tags = {
    Name = "sentient-eip"
  }
}

# -------------------------------------------------------------
# 8. CLOUDWATCH LOGS & ALARMS
# -------------------------------------------------------------
resource "aws_cloudwatch_log_group" "sentient_logs" {
  name              = "/aws/ec2/sentient"
  retention_in_days = 30
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "sentient-cpu-utilization-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Sentient EC2 runner CPU exceeds 80% for 5 minutes"

  dimensions = {
    InstanceId = aws_instance.sentient_runner.id
  }
}
