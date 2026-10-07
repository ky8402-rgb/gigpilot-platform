"""Authenticated operational telemetry."""
import os
import shutil
import subprocess
import time
from pathlib import Path

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
    for suffix in ("","-wal","-shm"):
        try:db+=os.path.getsize(str(p)+suffix)
        except OSError:pass
    out={"services":{"gigpilot-ml-l2.service":_svc("gigpilot-ml-l2.service"),"gigpilot-ml-train.timer":_svc("gigpilot-ml-train.timer")},
         "l2_buffer":{**l2,"db_bytes":db,"disk_total_bytes":u.total,"disk_used_bytes":u.used,"disk_free_bytes":u.free,
                      "disk_used_pct":u.used/u.total*100 if u.total else 0.0}}
    _CACHE=(now,out); return out
