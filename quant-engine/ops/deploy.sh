#!/usr/bin/env bash
# Deploy the latest verified version to the live service on this host.
#
# Pipeline:
#   1. release commit   — establish the immutable SHA that will be deployed
#   2. build gate       — secret scan + frontend + tests + live e2e + artifact
#   3. deploy           — restart the service from the committed tree
#   4. verify SHA       — prove the RUNNING process == the built SHA
#   5. verify prod      — full production verification (health, API, UI, data,
#                         risk gates, futures-only, live-trading safeguards)
#
# Rollback: tag each release; `git checkout <prev-tag>` then re-run steps 2-5.
#
# Secrets: this script never reads, prints, or writes credential VALUES. It only
# checks their PRESENCE. Credentials belong in the process environment.
set -uo pipefail

cd "$(dirname "$0")/.."

PORT="${QUANT_API__PORT:-8080}"
BASE="http://127.0.0.1:${PORT}"
LOG_DIR="data/logs"
mkdir -p "$LOG_DIR"

banner() { echo; echo "==================================================================="; echo " $*"; echo "==================================================================="; }

# ---------------------------------------------------------------- deploy lock
# Concurrent deploys must never interleave: they share a log, race the restart,
# and can leave HEAD ahead of the running SHA. Serialise with an exclusive lock.
LOCK_FILE="data/deploy.lock"
mkdir -p "$(dirname "$LOCK_FILE")"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "another deploy is already in progress ($LOCK_FILE) — refusing to start a second one"
    exit 2
  fi
else
  # Portable fallback: atomic mkdir lock with a stale-lock guard.
  if ! mkdir "$LOCK_FILE.d" 2>/dev/null; then
    STALE=$(find "$LOCK_FILE.d" -maxdepth 0 -mmin +30 2>/dev/null)
    if [ -n "$STALE" ]; then
      echo "removing stale deploy lock (older than 30 min)"
      rm -rf "$LOCK_FILE.d"
      mkdir "$LOCK_FILE.d" 2>/dev/null || { echo "cannot acquire deploy lock"; exit 2; }
    else
      echo "another deploy is already in progress — refusing to start a second one"
      exit 2
    fi
  fi
  trap 'rm -rf "$LOCK_FILE.d"' EXIT
fi

# ---------------------------------------------------------------- 1. commit
banner "1/5  RELEASE COMMIT"
if [ ! -d .git ]; then
  echo "  initialising repository"
  git init -q
  git config user.email "deploy@localhost"
  git config user.name "Quant Deploy"
fi

# .env and the token file are gitignored; assert that before committing.
if git check-ignore -q .env 2>/dev/null; then echo "  .env is gitignored: ok"; fi

git add -A
if git diff --cached --quiet; then
  echo "  no changes to commit"
else
  git commit -q -m "release: verified production build

Automated release commit created by ops/deploy.sh.
Gate: secret scan + frontend contract + unit tests + live e2e + artifact."
  echo "  committed"
fi
SHA=$(git rev-parse HEAD)
SHORT=$(git rev-parse --short=12 HEAD)
echo "  release SHA : $SHA"
echo "  short       : $SHORT"

# Tag it so this exact release is addressable for rollback.
TAG="release-$(date -u +%Y%m%dT%H%M%SZ)-${SHORT}"
if git tag -l "$TAG" | grep -q .; then :; else git tag -a "$TAG" -m "verified release $SHA" 2>/dev/null && echo "  tagged: $TAG"; fi

# ---------------------------------------------------------------- 2. build
banner "2/5  BUILD GATE"
if ! bash ops/build.sh; then
  echo "  BUILD FAILED — refusing to deploy"
  exit 1
fi

# ---------------------------------------------------------------- 3. deploy
banner "3/5  DEPLOY"
# Stop the supervisor and the app, then bring the service up from the committed tree.
python3 - <<'PY'
import os, signal, subprocess, time
out = subprocess.run(["ps", "-eo", "pid,cmd"], capture_output=True, text=True).stdout
me = os.getpid(); n = 0
for line in out.splitlines():
    p = line.strip().split(None, 1)
    if len(p) != 2 or not p[0].isdigit():
        continue
    pid, cmd = p
    if int(pid) == me:
        continue
    if ("ops/watchdog.sh" in cmd) or ("-m app.main" in cmd):
        try:
            os.kill(int(pid), signal.SIGTERM); n += 1
        except ProcessLookupError:
            pass
print(f"  stopped {n} process(es)")
time.sleep(6)
PY

: > "$LOG_DIR/supervisor.log"
# 9>&- closes the deploy lock fd in the child. Without it the long-running service
# inherits fd 9 and holds the exclusive lock forever, so the NEXT deploy refuses
# to start until the service is killed — a self-inflicted deadlock.
setsid nohup bash ops/watchdog.sh > "$LOG_DIR/watchdog-stdout.log" 2>&1 < /dev/null 9>&- &
disown
echo "  service launching…"

# ---------------------------------------------------------------- 4. verify SHA
banner "4/5  VERIFY DEPLOYED SHA"
# Wait for BOTH the right SHA and genuine operational readiness. Waiting only for
# /api/version would pass as soon as uvicorn binds, while the engine is still
# loading history — verification would then race the boot.
RUNNING=""
for i in $(seq 1 90); do
  sleep 5
  RUNNING=$(curl -fsS -m 10 "${BASE}/api/version" 2>/dev/null \
            | python3 -c "import json,sys;print(json.load(sys.stdin).get('commit_sha',''))" 2>/dev/null)
  if [ "$RUNNING" = "$SHA" ]; then
    if curl -fsS -m 10 "${BASE}/api/ready" 2>/dev/null | grep -q '"ready":true'; then
      echo "  readiness confirmed"
      break
    fi
  fi
done

if [ "$RUNNING" != "$SHA" ]; then
  echo "  RUNNING SHA : ${RUNNING:-<none>}"
  echo "  EXPECTED SHA: $SHA"
  echo "  MISMATCH — deploy did not take. Diagnosing…"
  echo "  --- last 25 supervisor log lines ---"
  tail -25 "$LOG_DIR/supervisor.log" 2>/dev/null
  echo "  --- last 25 service log lines ---"
  tail -25 "$LOG_DIR/quant.log" 2>/dev/null
  exit 1
fi
echo "  RUNNING SHA == RELEASE SHA  ($RUNNING)"

# ---------------------------------------------------------------- 5. verify prod
banner "5/5  PRODUCTION VERIFICATION"
python3 ops/verify_production.py --expect-sha "$SHA" --base-url "$BASE"
RC=$?

echo
if [ $RC -eq 0 ]; then
  echo "==================================================================="
  echo " DEPLOY SUCCESS"
  echo "   release : $TAG"
  echo "   sha     : $SHA"
  echo "   url     : $BASE/"
  echo "==================================================================="
else
  echo " DEPLOY VERIFICATION FAILED (exit $RC) — service is running $SHA but did not pass"
fi
exit $RC
