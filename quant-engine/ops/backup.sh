#!/usr/bin/env bash
# Consistent SQLite backup (uses the online backup API, so it is safe to run while
# the engine is trading) plus a rotation that keeps the last 14 snapshots.
set -euo pipefail

cd "$(dirname "$0")/.."

DB="data/db/quant.db"
DEST="data/backups"
mkdir -p "$DEST"

if [[ ! -f "$DB" ]]; then
  echo "no database at $DB yet"
  exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$DEST/quant-${STAMP}.db"

python3 - "$DB" "$OUT" <<'PY'
import sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
s = sqlite3.connect(src)
d = sqlite3.connect(dst)
with d:
    s.backup(d)          # online backup: consistent even mid-write
d.close(); s.close()
print(f"backed up {src} -> {dst}")
PY

# Rotation
ls -1t "$DEST"/quant-*.db 2>/dev/null | tail -n +15 | while read -r old; do
  echo "pruning $old"
  rm -f "$old"
done

echo "backup complete: $OUT"
