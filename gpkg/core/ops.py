"""Authenticated operational telemetry."""
import os
import shutil
import subprocess
import time
from pathlib import Path

from gpkg.core.constants import (
    L2_REQUIRED,  # dependency-free: ops.py is imported at app top level
)

_CACHE=(0.0,{})
def _svc(name):
    def run(arg):
        try:
            p=subprocess.run(["systemctl",arg,name],capture_output=True,text=True,timeout=1,check=False); return (p.stdout or p.stderr).strip()
        except Exception as e:return f"unavailable: {e}"
    state=run("is-active"); return {"name":name,"active":state=="active","state":state,"enabled":run("is-enabled")}
def operational_snapshot(store,db_path):
    global _CACHE
    now=time.monotonic()
    if now-_CACHE[0]<5:return _CACHE[1]
    p=Path(db_path).resolve(); root=p.parent; u=shutil.disk_usage(root if root.exists() else Path("."))
    l2=store.ml_market_buffer_stats("orderbook_l2"); db=0
    # PER-SYMBOL depth. `l2_buffer.rows` is a TOTAL across symbols, but the gate is per symbol, so a
    # total answers the wrong question: 9,000 rows across 3 symbols is 3,000 each, i.e. nowhere near
    # the gate, while the total alone looks like it is nearly there. `min_symbol` is the number that
    # actually decides when the phase is complete, so it is what the operator-facing bar shows.
    try:
        _by_symbol = {s: int(store.ml_market_buffer_stats_for_symbol(s, "orderbook_l2")["rows"])
                      for s in store.ml_market_symbols("orderbook_l2")}
    except Exception:
        _by_symbol = {}
    l2_depth = {"required": L2_REQUIRED,
                "symbols": _by_symbol,
                "min_symbol": min(_by_symbol.values()) if _by_symbol else 0,
                "ready": bool(_by_symbol) and all(v >= L2_REQUIRED for v in _by_symbol.values())}
    for suffix in ("","-wal","-shm"):
        try:db+=os.path.getsize(str(p)+suffix)
        except OSError:pass
    out={"services":{"gigpilot-ml-l2.service":_svc("gigpilot-ml-l2.service"),"gigpilot-ml-train.timer":_svc("gigpilot-ml-train.timer")},
         "l2_depth":l2_depth,
         "l2_buffer":{**l2,"db_bytes":db,"disk_total_bytes":u.total,"disk_used_bytes":u.used,"disk_free_bytes":u.free,
                      "disk_used_pct":u.used/u.total*100 if u.total else 0.0}}
    _CACHE=(now,out); return out
