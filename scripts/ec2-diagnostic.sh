#!/usr/bin/env bash
# ==============================================================================
# GigPilot EC2 Production Diagnostic & Self-Healing Doctor
# Checks Docker, Node.js backend, Python ML service, RDS Postgres, ElastiCache,
# SSL / Mixed-Content traps, Security Groups, and External APIs.
# ==============================================================================

set -uo pipefail

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0
WARNING_CHECKS=0

declare -a REPORT_SERVICES=()
declare -a REPORT_STATUS=()
declare -a REPORT_DETAILS=()
declare -a REMEDIATION_LOG=()

record_result() {
  local service="$1"
  local status="$2" # PASS, FAIL, WARN
  local details="$3"

  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  REPORT_SERVICES+=("$service")
  REPORT_STATUS+=("$status")
  REPORT_DETAILS+=("$details")

  if [ "$status" == "PASS" ]; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
    echo -e "  [${GREEN} PASS ${NC}] ${BOLD}${service}${NC}: ${details}"
  elif [ "$status" == "WARN" ]; then
    WARNING_CHECKS=$((WARNING_CHECKS + 1))
    echo -e "  [${YELLOW} WARN ${NC}] ${BOLD}${service}${NC}: ${details}"
  else
    FAILED_CHECKS=$((FAILED_CHECKS + 1))
    echo -e "  [${RED} FAIL ${NC}] ${BOLD}${service}${NC}: ${details}"
  fi
}

echo -e "\n${BOLD}${CYAN}===================================================================${NC}"
echo -e "${BOLD}${CYAN}  GIGPILOT EC2 BACKEND & ARCHITECTURE DIAGNOSTIC SUITE            ${NC}"
echo -e "${BOLD}${CYAN}  Timestamp: $(date -u '+%Y-%m-%d %H:%M:%S UTC')${NC}"
echo -e "${BOLD}${CYAN}===================================================================${NC}\n"

# ------------------------------------------------------------------------------
# 1. HOST SYSTEM & RESOURCE CHECKS
# ------------------------------------------------------------------------------
echo -e "${BOLD}1. Host Machine Health & Resource Verification${NC}"

# Disk space check
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -lt 85 ]; then
  record_result "Disk Storage" "PASS" "${DISK_USAGE}% used on root partition"
else
  record_result "Disk Storage" "WARN" "${DISK_USAGE}% used (exceeds 85% safety threshold)"
fi

# Memory check
FREE_RAM_MB=$(free -m | awk '/^Mem:/ {print $7}')
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/ {print $2}')
if [ "$FREE_RAM_MB" -gt 250 ]; then
  record_result "Memory (RAM)" "PASS" "${FREE_RAM_MB}MB available out of ${TOTAL_RAM_MB}MB"
else
  record_result "Memory (RAM)" "WARN" "${FREE_RAM_MB}MB available (tight memory for Docker builds)"
fi

# ------------------------------------------------------------------------------
# 2. DOCKER & DOCKER COMPOSE ENGINE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}2. Container Runtime Engine${NC}"

if systemctl is-active --quiet docker; then
  record_result "Docker Daemon" "PASS" "Docker service is active and running"
else
  record_result "Docker Daemon" "FAIL" "Docker service is inactive or stopped"
  REMEDIATION_LOG+=("Restarted docker daemon via 'sudo systemctl restart docker'")
  sudo systemctl restart docker || true
fi

# Check Docker Compose binary
if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
  COMPOSE_CMD="docker compose"
  if ! docker compose version &> /dev/null; then COMPOSE_CMD="docker-compose"; fi
  record_result "Compose CLI" "PASS" "Using binary: ${COMPOSE_CMD}"
else
  record_result "Compose CLI" "FAIL" "Neither 'docker compose' nor 'docker-compose' found"
fi

# ------------------------------------------------------------------------------
# 3. CONTAINER HEALTH (Node.js backend & Python ML Service)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}3. Backend Microservice Containers${NC}"

# Find app container (match names like app, backend, gigpilot-app)
APP_CONTAINER=$(docker ps --filter "name=app" --format "{{.Names}}" | head -n 1)
if [ -z "$APP_CONTAINER" ]; then
  APP_CONTAINER=$(docker ps --filter "name=backend" --format "{{.Names}}" | head -n 1)
fi

if [ -n "$APP_CONTAINER" ]; then
  APP_STATUS=$(docker inspect --format='{{.State.Status}}' "$APP_CONTAINER" 2>/dev/null || echo "unknown")
  APP_UPTIME=$(docker inspect --format='{{.State.StartedAt}}' "$APP_CONTAINER" 2>/dev/null || echo "")
  record_result "Node Backend Container" "PASS" "Container '$APP_CONTAINER' is $APP_STATUS (Started: $APP_UPTIME)"
else
  record_result "Node Backend Container" "FAIL" "No running container named '*app*' or '*backend*'"
  REMEDIATION_LOG+=("Attempted container start via '$COMPOSE_CMD up -d'")
  $COMPOSE_CMD up -d || true
fi

# Find ML service container
ML_CONTAINER=$(docker ps --filter "name=ml" --format "{{.Names}}" | head -n 1)
if [ -n "$ML_CONTAINER" ]; then
  ML_STATUS=$(docker inspect --format='{{.State.Status}}' "$ML_CONTAINER" 2>/dev/null || echo "unknown")
  record_result "Python ML Microservice" "PASS" "Container '$ML_CONTAINER' is $ML_STATUS"
else
  record_result "Python ML Microservice" "WARN" "Container '*ml*' not running. (Optional if ML runs in-process)"
fi

# ------------------------------------------------------------------------------
# 4. LOCAL PORT BINDINGS & HTTP PROBES
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}4. Local Health Probes (Localhost)${NC}"

# Test Node.js backend port 3000
NODE_HEALTH=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health || echo "000")
if [ "$NODE_HEALTH" == "200" ]; then
  record_result "Port 3000 /api/health" "PASS" "Returned HTTP 200 OK"
else
  NODE_PING=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health/ping || echo "000")
  if [ "$NODE_PING" == "200" ]; then
    record_result "Port 3000 /api/health/ping" "PASS" "Fallback ping endpoint returned HTTP 200 OK"
  else
    record_result "Port 3000 HTTP Health" "FAIL" "Failed to respond on 127.0.0.1:3000 (HTTP Code: $NODE_HEALTH)"
  fi
fi

# Test ML service port 8000 (if running)
if [ -n "$ML_CONTAINER" ]; then
  ML_HEALTH=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/health || echo "000")
  if [ "$ML_HEALTH" == "200" ]; then
    record_result "Port 8000 ML Health" "PASS" "Returned HTTP 200 OK"
  else
    record_result "Port 8000 ML Health" "WARN" "ML service returned HTTP $ML_HEALTH"
  fi
fi

# ------------------------------------------------------------------------------
# 5. DATABASE (RDS POSTGRESQL) CONNECTIVITY
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}5. Relational Database (RDS PostgreSQL)${NC}"

# Source environment file if available
if [ -f .env ]; then
  # export variables safely without breaking on complex values
  set -a
  source <(grep -E '^(DATABASE_URL|POSTGRES_URL|REDIS_URL|PAYPAL_|FREELANCER_)' .env | sed 's/\r$//')
  set +a
fi

DB_URL="${DATABASE_URL:-${POSTGRES_URL:-}}"
if [ -n "$DB_URL" ]; then
  # Parse host and port
  DB_HOST=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+).*|\1|')
  DB_PORT=$(echo "$DB_URL" | sed -E 's|.*@([^:/]+):([0-9]+).*|\2|')
  if [ "$DB_PORT" == "$DB_URL" ]; then DB_PORT=5432; fi

  # TCP socket ping
  if nc -z -w 3 "$DB_HOST" "$DB_PORT" 2>/dev/null || (echo > /dev/tcp/"$DB_HOST"/"$DB_PORT") 2>/dev/null; then
    record_result "RDS Network Socket" "PASS" "Connected to ${DB_HOST}:${DB_PORT}"
  else
    record_result "RDS Network Socket" "FAIL" "Cannot reach ${DB_HOST}:${DB_PORT} (Check Security Group inbound to port 5432)"
  fi

  # Query check using node one-liner
  DB_TEST=$(node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL, connectionTimeoutMillis: 4000 });
    pool.query('SELECT 1 as alive;', (err, res) => {
      if (err) { console.log('ERROR:' + err.message); process.exit(1); }
      console.log('OK');
      pool.end();
    });
  " 2>&1 || echo "ERROR: Node query failed")

  if [[ "$DB_TEST" == *"OK"* ]]; then
    record_result "RDS SQL Query (SELECT 1)" "PASS" "Successfully executed query against RDS instance"
  else
    record_result "RDS SQL Query (SELECT 1)" "FAIL" "Query failed: ${DB_TEST}"
  fi
else
  record_result "RDS PostgreSQL URL" "WARN" "DATABASE_URL not found in environment or .env"
fi

# ------------------------------------------------------------------------------
# 6. REDIS CACHE & QUEUE ENGINE
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}6. Cache & Queue Engine (Redis)${NC}"

REDIS_URL="${REDIS_URL:-redis://red-daarifid0e5s7392b3k0:6379}"
REDIS_HOST=$(echo "$REDIS_URL" | sed -E 's|.*://([^:/]+).*|\1|')
REDIS_PORT=$(echo "$REDIS_URL" | sed -E 's|.*://([^:/]+):([0-9]+).*|\2|')
if [ "$REDIS_PORT" == "$REDIS_URL" ]; then REDIS_PORT=6379; fi

if nc -z -w 3 "$REDIS_HOST" "$REDIS_PORT" 2>/dev/null || (echo > /dev/tcp/"$REDIS_HOST"/"$REDIS_PORT") 2>/dev/null; then
  record_result "Redis Network Socket" "PASS" "Connected to ${REDIS_HOST}:${REDIS_PORT}"
else
  record_result "Redis Network Socket" "WARN" "Cannot reach ${REDIS_HOST}:${REDIS_PORT} (In-memory fallback cache will be used)"
fi

# ------------------------------------------------------------------------------
# 7. PUBLIC REACHABILITY & HTTPS / MIXED CONTENT DETECTOR
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}7. Ingress Networking & Mixed Content Inspection${NC}"

# Fetch public Elastic IP
PUBLIC_IP=$(curl -s -m 4 https://ifconfig.me || curl -s -m 4 https://api.ipify.org || echo "unknown")
record_result "EC2 Public IP" "PASS" "Elastic / Public IP is: $PUBLIC_IP"

# Check if Nginx or Web Server is running on port 80/443
PORT_80=$(netstat -tlpn 2>/dev/null | grep -E ':(80|443)\s' || ss -tlpn 2>/dev/null | grep -E ':(80|443)\s' || echo "")
if [ -n "$PORT_80" ]; then
  record_result "Ingress Web Proxy (80/443)" "PASS" "Web server (Nginx/Caddy) is listening on public web ports"
else
  record_result "Ingress Web Proxy (80/443)" "WARN" "Port 80/443 not listening. Frontend connecting directly to port 3000 or requires reverse proxy."
fi

# Check SSL Certificate if a domain is configured
DOMAIN=$(grep -E '^VITE_BACKEND_URL=' .env 2>/dev/null | cut -d '=' -f2 | sed -e 's|^[^/]*//||' -e 's|/.*$||' || echo "")
if [[ "$DOMAIN" == *"http://"* ]] || [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+ ]]; then
  record_result "Mixed-Content Audit" "FAIL" "Amplify serves over HTTPS! Connecting to plain HTTP IP ($DOMAIN) triggers browser Mixed Content blocks."
elif [ -n "$DOMAIN" ] && [[ "$DOMAIN" == *"https://"* ]]; then
  record_result "Mixed-Content Audit" "PASS" "Backend URL is configured with HTTPS: $DOMAIN"
fi

# ------------------------------------------------------------------------------
# 8. EXTERNAL API INTEGRATIONS (PayPal & Freelancer)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}8. External Partner API Reachability${NC}"

# Freelancer API Ping
FL_STATUS=$(curl -s -m 5 -o /dev/null -w "%{http_code}" https://www.freelancer.com/api/projects/0.1/projects/active || echo "000")
if [ "$FL_STATUS" == "200" ] || [ "$FL_STATUS" == "401" ] || [ "$FL_STATUS" == "403" ]; then
  record_result "Freelancer API" "PASS" "Endpoint reachable (HTTP $FL_STATUS - network link OK)"
else
  record_result "Freelancer API" "FAIL" "Cannot reach freelancer.com (HTTP $FL_STATUS - check outbound internet NAT/IGW)"
fi

# PayPal API Ping
PP_STATUS=$(curl -s -m 5 -o /dev/null -w "%{http_code}" https://api-m.sandbox.paypal.com/v1/oauth2/token || echo "000")
if [ "$PP_STATUS" == "401" ] || [ "$PP_STATUS" == "200" ]; then
  record_result "PayPal Sandbox OAuth" "PASS" "PayPal endpoint reachable (HTTP $PP_STATUS - TLS handshake verified)"
else
  record_result "PayPal Sandbox OAuth" "FAIL" "Cannot reach PayPal API (HTTP $PP_STATUS)"
fi

# ------------------------------------------------------------------------------
# 9. SUMMARY SCORECARD & FINAL STATUS
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${CYAN}===================================================================${NC}"
echo -e "${BOLD}${CYAN}  DIAGNOSTIC SUMMARY & HEALTH REPORT                               ${NC}"
echo -e "${BOLD}${CYAN}===================================================================${NC}"

printf "%-30s | %-8s | %s\n" "SERVICE / COMPONENT" "STATUS" "DETAILS"
echo "------------------------------------------------------------------------------------------------"
for i in "${!REPORT_SERVICES[@]}"; do
  status_color="$GREEN"
  if [ "${REPORT_STATUS[$i]}" == "WARN" ]; then status_color="$YELLOW"; fi
  if [ "${REPORT_STATUS[$i]}" == "FAIL" ]; then status_color="$RED"; fi

  printf "%-30s | ${status_color}%-8s${NC} | %s\n" \
    "${REPORT_SERVICES[$i]}" \
    "${REPORT_STATUS[$i]}" \
    "${REPORT_DETAILS[$i]}"
done
echo "------------------------------------------------------------------------------------------------"

OVERALL_STATUS="HEALTHY"
if [ "$FAILED_CHECKS" -gt 0 ]; then
  if [ "$FAILED_CHECKS" -ge 3 ]; then
    OVERALL_STATUS="CRITICAL"
    STATUS_COLOR="$RED"
  else
    OVERALL_STATUS="DEGRADED"
    STATUS_COLOR="$YELLOW"
  fi
else
  STATUS_COLOR="$GREEN"
fi

echo -e "\nScorecard: ${GREEN}${PASSED_CHECKS} Passed${NC}, ${YELLOW}${WARNING_CHECKS} Warnings${NC}, ${RED}${FAILED_CHECKS} Failed${NC} (Total: ${TOTAL_CHECKS})"
echo -e "Overall Cluster State: ${BOLD}${STATUS_COLOR}${OVERALL_STATUS}${NC}\n"

if [ ${#REMEDIATION_LOG[@]} -gt 0 ]; then
  echo -e "${BOLD}Automated Remediations Executed:${NC}"
  for item in "${REMEDIATION_LOG[@]}"; do
    echo -e "  &rarr; $item"
  done
  echo ""
fi

# Exit with code 1 if critical
if [ "$OVERALL_STATUS" == "CRITICAL" ]; then
  exit 1
fi
exit 0
