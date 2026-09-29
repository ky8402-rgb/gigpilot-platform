#!/usr/bin/env bash
# Install this platform on a Debian/Ubuntu production host.
#
# DESIGNED TO COEXIST. This installer never touches another application:
#   * it does NOT stop, replace or reconfigure any existing service
#   * it does NOT occupy 443 (nginx keeps it); the app binds 127.0.0.1:8080 and is
#     reached through its own nginx vhost on a SEPARATE hostname
#   * it refuses to continue if the target port is already in use
#
# Run from the extracted release directory:
#     sudo bash ops/production/install.sh
#
# Then follow ops/production/README.md.
set -euo pipefail

APP_USER="${APP_USER:-quant}"
APP_DIR="${APP_DIR:-/opt/quant}"
ENV_DIR="${ENV_DIR:-/etc/quant}"
PORT="${QUANT_API__PORT:-8080}"
RELEASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
FAILED=0

say()  { echo "[install] $*"; }
warn() { echo "[install] WARNING: $*"; }
die()  { echo "[install] ERROR: $*" >&2; exit 1; }

say "release directory: $RELEASE_DIR"
say "target: $APP_DIR  user: $APP_USER  port: $PORT"

# ---------------------------------------------------------------- preconditions
[ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"

if command -v apt-get >/dev/null 2>&1; then
  say "installing system packages"
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3 python3-venv python3-pip curl >/dev/null
else
  warn "apt-get not found; assuming python3 and pip are already present"
fi

command -v python3 >/dev/null 2>&1 || die "python3 is required"

# Refuse to collide with whatever is already listening.
if command -v ss >/dev/null 2>&1; then
  if ss -ltnp 2>/dev/null | grep -q ":${PORT} "; then
    die "port ${PORT} is already in use. Another service owns it:
$(ss -ltnp 2>/dev/null | grep ":${PORT} ")
Pick a different port with QUANT_API__PORT=<port> and update the nginx vhost."
  fi
else
  warn "ss unavailable; could not verify that port ${PORT} is free"
fi

# ---------------------------------------------------------------- app user
if id -u "$APP_USER" >/dev/null 2>&1; then
  say "user $APP_USER already exists"
else
  say "creating system user $APP_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

# ---------------------------------------------------------------- files
say "installing application to $APP_DIR"
mkdir -p "$APP_DIR"
# Copy the release, never touching data/ or .env on an upgrade.
tar -C "$RELEASE_DIR" \
    --exclude='./data' --exclude='./.git' --exclude='./.venv' \
    --exclude='__pycache__' --exclude='.pytest_cache' --exclude='./build' \
    -cf - . | tar -C "$APP_DIR" -xf -
mkdir -p "$APP_DIR/data/db" "$APP_DIR/data/logs"

say "creating virtualenv"
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --quiet --upgrade pip
"$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------- secrets
say "preparing $ENV_DIR/quant.env"
mkdir -p "$ENV_DIR"
if [ -f "$ENV_DIR/quant.env" ]; then
  say "$ENV_DIR/quant.env exists — leaving it untouched"
elif [ -f "$RELEASE_DIR/.env" ]; then
  install -m 600 -o root -g root "$RELEASE_DIR/.env" "$ENV_DIR/quant.env"
  say "copied credentials from the release .env"
else
  install -m 600 -o root -g root /dev/null "$ENV_DIR/quant.env"
  warn "$ENV_DIR/quant.env is EMPTY — add credentials before arming live:
        QUANT__EXCHANGE__API_KEY=...
        QUANT__EXCHANGE__API_SECRET=..."
fi

# ---------------------------------------------------------------- systemd
say "installing systemd unit"
sed -e "s#__APP_DIR__#${APP_DIR}#g" \
    -e "s#__APP_USER__#${APP_USER}#g" \
    -e "s#__ENV_DIR__#${ENV_DIR}#g" \
    -e "s#__PORT__#${PORT}#g" \
    "$APP_DIR/ops/production/quant.service.tmpl" > /etc/systemd/system/quant.service
mkdir -p /var/log/quant && chown "$APP_USER:$APP_USER" /var/log/quant
systemctl daemon-reload
systemctl enable quant >/dev/null
say "starting service"
systemctl restart quant

# ---------------------------------------------------------------- verify
say "waiting for the service to answer"
OK=0
for _ in $(seq 1 40); do
  if curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done

if [ "$OK" -ne 1 ]; then
  echo
  warn "the service did not answer on 127.0.0.1:${PORT}. Diagnostics:"
  systemctl --no-pager -l status quant | tail -20 || true
  echo "--- last log lines ---"
  journalctl -u quant --no-pager -n 40 2>/dev/null || tail -40 /var/log/quant/stdout.log 2>/dev/null || true
  die "install incomplete"
fi

echo
say "health:"
curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/health" || true
echo
say "version:"
curl -fsS -m 5 "http://127.0.0.1:${PORT}/api/version" || true
echo

cat <<EOF

===================================================================
 INSTALLED (paper mode — no orders will be sent)
===================================================================
 app        : $APP_DIR
 service    : systemctl status quant
 env file   : $ENV_DIR/quant.env  (0600)
 logs       : journalctl -u quant -f   and   $APP_DIR/data/logs/
 dashboard  : retrieve the token with:
                  sudo cat $APP_DIR/data/dashboard_token.txt
              then open http://127.0.0.1:${PORT}/  (tunnel or vhost)

 NEXT
   1. Expose it over TLS:  see ops/production/README.md  (nginx vhost + certbot)
   2. Record which host this is so the platform can verify itself:
          sudo -e $ENV_DIR/quant.env      # add QUANT__EXCHANGE__EXPECTED_HOST_IP
      (so a live configuration refuses to run on the wrong machine)
   3. Run the go-live preflight:  bash ops/preflight_live.py
   4. Arm deliberately:           bash ops/go_live.sh            (dry run)
                                  bash ops/go_live.sh --confirm  (arms)
   Emergency stop, no API needed:  touch $APP_DIR/data/HALT
===================================================================
EOF
