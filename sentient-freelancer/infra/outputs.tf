output "ec2_public_ip" {
  description = "Elastic IP address attached to Sentient EC2 runner"
  value       = aws_eip.sentient_eip.public_ip
}

output "ec2_instance_id" {
  description = "EC2 Instance ID for SSM Session Manager"
  value       = aws_instance.sentient_runner.id
}

output "s3_bucket_name" {
  description = "S3 bucket for artifacts and memory snapshots"
  value       = aws_s3_bucket.sentient_artifacts.bucket
}

output "redis_endpoint" {
  description = "ElastiCache Redis primary endpoint"
  value       = aws_elasticache_cluster.sentient_redis.cache_nodes[0].address
}

output "ssm_token_param" {
  description = "SSM Parameter Store path for Bearer authentication token"
  value       = aws_ssm_parameter.sentient_token.name
}

output "api_url" {
  description = "Public API endpoint for Sentient Freelancer backend"
  value       = "http://${aws_eip.sentient_eip.public_ip}:8080"
}
