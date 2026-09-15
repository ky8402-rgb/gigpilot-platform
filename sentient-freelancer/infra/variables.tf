variable "aws_region" {
  type        = string
  description = "AWS region for EC2, S3, and ElastiCache deployment"
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Deployment environment name"
  default     = "production"
}

variable "instance_type" {
  type        = string
  description = "EC2 instance size (t3.medium recommended for Puppeteer + Node)"
  default     = "t3.medium"
}

variable "admin_cidr" {
  type        = string
  description = "Admin CIDR allowed for SSH ingress (if SSH enabled)"
  default     = "0.0.0.0/0"
}

variable "allowed_origin" {
  type        = string
  description = "Allowed CORS origin from AWS Amplify frontend"
  default     = "*"
}
