#!/usr/bin/env bash
# Arm (or disarm) live order routing.
#
# Arming is the one action in this project that can move real money, so it is
# deliberately NOT automatic: the default mode is a DRY RUN that reports exactly
# what would change. Pass --confirm to actually arm.
#
# Arming requires all four interlock signals, so this script sets the two that are
# ours to set:
#     execution.mode: live        (config.yaml)
#     execution.allow_live: true  (config.yaml)
#     API credentials             (.env, owner-supplied, never touched here)
#     QUANT_LIVE_TRADING_ACK=yes  (.env, set by --confirm)
#
# Usage:
#   ops/go_live.sh                 # dry run: preflight + what would change
#   ops/go_live.sh --confirm       # arm and deploy
#   ops/go_live.sh --disarm        # revert to paper and deploy
set -uo pipefail

cd "$(dirname "$0")/.."

CONFIG="config/config.yaml"
ENV_FILE=".env"
MODE="${1:-dry-run}"

banner() { echo; echo "==================================================================="; echo " $*"; echo "==================================================================="; }

flip_config() {
  # $1 = mode value, $2 = allow_live value
  python3 - "$CONFIG" "$1" "$2" <<'PY'
import re, sys
path, mode, allow = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
src = re.sub(r'(?m)^(\s*)mode:\s*(paper|live)\s*$', rf'\g<1>mode: {mode}', src, count=1)
src = re.sub(r'(?m)^(\s*)allow_live:\s*(true|false)\s*$', rf'\g<1>allow_live: {allow}', src, count=1)
open(path, "w").write(src)
print(f"  config.yaml -> mode: {mode}, allow_live: {allow}")
PY
}

set_ack() {
  python3 - "$ENV_FILE" "$1" <<'PY'
import os, sys
path, value = sys.argv[1], sys.argv[2]
lines = []
if os.path.exists(path):
    lines = [l for l in open(path).read().splitlines()
             if not l.strip().startswith("QUANT_LIVE_TRADING_ACK=")]
if value:
    lines.append(f"QUANT_LIVE_TRADING_ACK={value}")
open(path, "w").write("\n".join(lines) + "\n")
os.chmod(path, 0o600)
print(f"  .env -> QUANT_LIVE_TRADING_ACK {'set' if value else 'removed'} (0600)")
PY
}

# ---------------------------------------------------------------------------
if [ "$MODE" = "--disarm" ]; then
  banner "DISARMING LIVE TRADING"
  flip_config paper false
  set_ack ""
  banner "PREFLIGHT AFTER DISARM"
  python3 ops/preflight_live.py
  echo
  read -r -p "Deploy the disarmed configuration now? [y/N] " ans
  if [ "${ans,,}" = "y" ]; then bash ops/deploy.sh; else echo "  not deployed"; fi
  exit 0
fi

# ---------------------------------------------------------------------------
banner "STEP 1/3  PREFLIGHT (must be clear before arming)"
python3 ops/preflight_live.py
PRE=$?
if [ $PRE -ne 0 ]; then
  echo
  echo "PREFLIGHT BLOCKED — not arming. Resolve the blockers listed above."
  exit 1
fi

banner "STEP 2/3  WHAT ARMING WOULD CHANGE"
echo "  config/config.yaml : execution.mode -> live, execution.allow_live -> true"
echo "  .env               : QUANT_LIVE_TRADING_ACK=yes  (0600)"
echo "  then               : full rebuild + deploy + production verification"
echo
echo "  Effect: every setup that clears the cost hurdle will be sent to"
echo "          $(python3 -c "from app.config import load_config;print(load_config().exchange.name)" 2>/dev/null || echo the-exchange)"
echo "          as a real order, sized against the exchange's reported equity."
echo "          Risk limits, the daily-loss limit and the drawdown kill switch all"
echo "          remain in force, and open positions keep their stops."

if [ "$MODE" != "--confirm" ]; then
  echo
  echo "DRY RUN — nothing changed. Re-run with --confirm to arm."
  echo
  echo "Emergency stop at any time (no API access needed):  touch data/HALT"
  exit 0
fi

banner "STEP 3/3  ARMING"
echo "This will enable REAL order routing. Type ARM to proceed."
read -r ans
if [ "$ans" != "ARM" ]; then
  echo "  aborted (typed '$ans')"
  exit 1
fi

flip_config live true
set_ack yes

echo
echo "re-running preflight in the ARMED configuration:"
python3 ops/preflight_live.py | tail -20

echo
echo "deploying the armed build…"
bash ops/deploy.sh
RC=$?

echo
if [ $RC -eq 0 ]; then
  banner "LIVE TRADING ARMED AND DEPLOYED"
  echo "  Emergency stop : touch data/HALT   (resume: rm data/HALT)"
  echo "  Operator halt  : POST /api/control/halt"
  echo "  Disarm         : bash ops/go_live.sh --disarm"
else
  banner "ARMED BUT VERIFICATION FAILED"
  echo "  The config is armed but the deploy did not verify. Trading may be live."
  echo "  Disarm immediately:  bash ops/go_live.sh --disarm"
fi
exit $RC
