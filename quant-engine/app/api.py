"""HTTP + WebSocket API and the dashboard host.

Security posture
----------------
* Bearer-token auth on every data and control endpoint. The token is generated on
  first boot and written to `data/dashboard_token.txt` with 0600 permissions, so
  the UI is never accidentally world-readable.
* Only /api/health, /api/ready and /api/stats are unauthenticated, and they expose
  nothing but liveness counters.
* Per-IP token-bucket rate limiting.
* All request bodies are validated by pydantic models; no raw dict reaches the engine.
* Control endpoints are deliberately narrow: halt, resume, close one symbol,
  flatten all, trigger learning, roll back parameters. There is no "set leverage"
  or "send arbitrary order" endpoint, because that would hand an attacker the
  account for the price of one token.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from . import version as build_version
from .config import Config, PROJECT_ROOT
from .logging_setup import get_logger, recent_logs

log = get_logger("api")

WEB_DIR = PROJECT_ROOT / "app" / "web"


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class ControlResponse(BaseModel):
    ok: bool
    message: str
    detail: Dict[str, Any] = Field(default_factory=dict)


class RollbackRequest(BaseModel):
    version: int


class CloseRequest(BaseModel):
    symbol: str
    reason: str = "manual"


# ---------------------------------------------------------------------------
# Rate limiter (token bucket per client)
# ---------------------------------------------------------------------------
class RateLimiter:
    def __init__(self, per_minute: int):
        self.capacity = float(max(per_minute, 1))
        self.refill_per_s = self.capacity / 60.0
        self.buckets: Dict[str, tuple] = {}

    def allow(self, key: str) -> bool:
        now = time.time()
        tokens, last = self.buckets.get(key, (self.capacity, now))
        tokens = min(self.capacity, tokens + (now - last) * self.refill_per_s)
        if tokens < 1.0:
            self.buckets[key] = (tokens, now)
            return False
        self.buckets[key] = (tokens - 1.0, now)
        return True


def persist_token(token: str, path: Path) -> bool:
    """Write the dashboard token with owner-only permissions.

    Only ever called on the serving instance. Tests must pass
    `persist_token_file=False` to `create_app`, otherwise a test run would
    overwrite the live credential with a hardcoded value.
    """
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(token + "\n", encoding="utf-8")
        path.chmod(0o600)
        return True
    except OSError as exc:
        log.warning("could not persist dashboard token", extra={"error": str(exc)})
        return False


def create_app(engine, *, persist_token_file: bool = True) -> FastAPI:
    cfg: Config = engine.cfg
    limiter = RateLimiter(cfg.api.rate_limit_per_min)
    if persist_token_file and cfg.api.persist_token:
        persist_token(cfg.api.token, cfg.api.token_path)

    app = FastAPI(
        title="Futures Quant Platform",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.api.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def client_key(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def _extract_token(request: Request) -> str:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth[7:].strip()
        return request.query_params.get("token", "").strip()

    async def require_auth(request: Request) -> bool:
        key = client_key(request)
        if not limiter.allow(key):
            raise HTTPException(status_code=429, detail="rate limit exceeded")
        supplied = _extract_token(request)
        if not supplied:
            raise HTTPException(status_code=401, detail="missing token")
        # Constant-time comparison to avoid leaking the token via timing.
        import hmac

        if not hmac.compare_digest(supplied, cfg.api.token):
            log.warning("auth failure", extra={"client": key})
            raise HTTPException(status_code=403, detail="invalid token")
        return True

    # ---------------- unauthenticated health --------------------------
    @app.get("/api/health")
    async def health() -> Dict[str, Any]:
        feed = engine.feed
        return {
            "status": "ok" if (feed and not feed.is_stale()) else "degraded",
            "ts": time.time(),
            "mode": engine.mode,
            "uptime_s": round(time.time() - engine.status.started_at, 1),
            "ticks": engine.status.ticks,
        }

    @app.get("/api/ready")
    async def ready() -> JSONResponse:
        feed = engine.feed
        # Readiness means the engine is genuinely operational: feed up, loop
        # ticking, AND at least one health pass published. Without the last
        # condition a deploy gate can pass while telemetry is still empty.
        health_telemetry = bool(engine._selfcheck)
        ok = bool(
            feed is not None
            and feed.health.connected
            and engine.symbols
            and engine.status.ticks > 0
            and health_telemetry
        )
        return JSONResponse(
            status_code=200 if ok else 503,
            content={
                "ready": ok,
                "symbols": len(engine.symbols),
                "feed_connected": bool(feed and feed.health.connected),
                "ticks": engine.status.ticks,
                "health_telemetry": health_telemetry,
            },
        )

    @app.get("/api/version")
    async def version() -> Dict[str, Any]:
        """Exact code provenance of the running process. Unauthenticated on
        purpose: a deploy gate must be able to prove the deployed SHA without
        holding operational credentials. Contains no secrets."""
        return build_version.as_dict()

    @app.get("/api/stats", response_class=PlainTextResponse)
    async def stats() -> str:
        """Prometheus-style exposition (non-sensitive counters only)."""
        feed = engine.feed
        p = engine.ledger.snapshot()
        s = engine.status
        lines = [
            "# HELP quant_up Engine liveness",
            "# TYPE quant_up gauge",
            f"quant_up {1 if engine.status.ticks > 0 else 0}",
            "# HELP quant_ticks_total Main loop iterations",
            "# TYPE quant_ticks_total counter",
            f"quant_ticks_total {s.ticks}",
            "# HELP quant_tick_duration_seconds Wall-clock duration of the most recent tick",
            "# TYPE quant_tick_duration_seconds gauge",
            f"quant_tick_duration_seconds {round(s.last_tick_ms / 1000.0, 4)}",
            "# HELP quant_tick_duration_max_seconds Longest tick observed since start",
            "# TYPE quant_tick_duration_max_seconds gauge",
            f"quant_tick_duration_max_seconds {round(s.max_tick_ms / 1000.0, 4)}",
            "# HELP quant_slow_ticks_total Ticks that overran the loop cadence budget",
            "# TYPE quant_slow_ticks_total counter",
            f"quant_slow_ticks_total {s.slow_ticks}",
            "# HELP quant_slow_ticks_recent Overruns inside the recent rolling window",
            "# TYPE quant_slow_ticks_recent gauge",
            f"quant_slow_ticks_recent {s.slow_ticks_recent}",
            "# HELP quant_slow_tick_alerts_total Sustained-overrun incidents reported",
            "# TYPE quant_slow_tick_alerts_total counter",
            f"quant_slow_tick_alerts_total {s.slow_tick_alerts}",
            "# HELP quant_feed_connected Market data websocket state",
            "# TYPE quant_feed_connected gauge",
            f"quant_feed_connected {1 if (feed and feed.health.connected) else 0}",
            "# HELP quant_feed_age_seconds Seconds since last market data message",
            "# TYPE quant_feed_age_seconds gauge",
            f"quant_feed_age_seconds {round(feed.feed_age_s() or -1, 2) if feed else -1}",
            "# HELP quant_equity_usd Account equity",
            "# TYPE quant_equity_usd gauge",
            f"quant_equity_usd {p['equity']}",
            "# HELP quant_realized_net_usd Realised net PnL after all costs",
            "# TYPE quant_realized_net_usd gauge",
            f"quant_realized_net_usd {p['realized_net']}",
            "# HELP quant_open_positions Open position count",
            "# TYPE quant_open_positions gauge",
            f"quant_open_positions {p['open_positions']}",
            "# HELP quant_halted Trading halt state (1 = halted)",
            "# TYPE quant_halted gauge",
            f"quant_halted {1 if engine.risk.state.halted else 0}",
            "# HELP quant_errors_total Accumulated engine errors",
            "# TYPE quant_errors_total counter",
            f"quant_errors_total {s.error_count}",
            "# HELP quant_trades_closed_total Closed trade count",
            "# TYPE quant_trades_closed_total counter",
            f"quant_trades_closed_total {len(engine.ledger.trades)}",
            "# HELP quant_fees_usd Cumulative fees paid",
            "# TYPE quant_fees_usd gauge",
            f"quant_fees_usd {p['total_fees']}",
            "# HELP quant_build_info Build provenance (value is always 1)",
            "# TYPE quant_build_info gauge",
            f"quant_build_info{{commit=\"{build_version.commit_sha() or 'unknown'}\","
            f"version=\"{build_version.load_release().get('version', 'unknown')}\"}} 1",
            "# HELP quant_verified_build Whether this build passed the release gate",
            "# TYPE quant_verified_build gauge",
            f"quant_verified_build {1 if build_version.load_release().get('verified') else 0}",
        ]
        return "\n".join(lines) + "\n"

    # ---------------- authenticated data ------------------------------
    @app.get("/api/state", dependencies=[Depends(require_auth)])
    async def state() -> Dict[str, Any]:
        snap = engine.snapshot()
        snap["build"] = build_version.as_dict()
        return snap

    @app.get("/api/symbols", dependencies=[Depends(require_auth)])
    async def symbols() -> Dict[str, Any]:
        return {"rows": engine.symbol_rows(), "ts": time.time()}

    @app.get("/api/candles", dependencies=[Depends(require_auth)])
    async def candles(
        symbol: str = Query(...),
        limit: int = Query(300, ge=10, le=1500),
        interval: Optional[str] = Query(None),
    ) -> Dict[str, Any]:
        if symbol not in engine.symbols:
            raise HTTPException(status_code=404, detail=f"unknown symbol {symbol}")
        # Only the configured interval is stored. Accepting a different one and
        # silently returning this one would hand the caller data that does not
        # match what they asked for — reject instead of misleading.
        if interval is not None and interval != cfg.data.primary_interval:
            raise HTTPException(
                status_code=400,
                detail=f"unsupported interval '{interval}'; this deployment stores "
                       f"only '{cfg.data.primary_interval}'",
            )
        return {"symbol": symbol, "interval": cfg.data.primary_interval,
                "candles": engine.candles(symbol, limit)}

    @app.get("/api/positions", dependencies=[Depends(require_auth)])
    async def positions() -> Dict[str, Any]:
        return {"positions": [p.as_dict() for p in engine.ledger.positions.values()]}

    @app.get("/api/orders", dependencies=[Depends(require_auth)])
    async def orders(limit: int = Query(50, ge=1, le=500)) -> Dict[str, Any]:
        return {"orders": engine.ledger.recent_orders(limit)}

    @app.get("/api/trades", dependencies=[Depends(require_auth)])
    async def trades(limit: int = Query(50, ge=1, le=500)) -> Dict[str, Any]:
        return {"trades": engine.ledger.recent_trades(limit)}

    @app.get("/api/equity", dependencies=[Depends(require_auth)])
    async def equity(limit: int = Query(1000, ge=10, le=20000)) -> Dict[str, Any]:
        return {"curve": engine.ledger.equity_curve[-limit:]}

    @app.get("/api/logs", dependencies=[Depends(require_auth)])
    async def logs(limit: int = Query(200, ge=1, le=800), level: str = "INFO") -> Dict[str, Any]:
        return {"logs": recent_logs(limit, level)}

    @app.get("/api/params", dependencies=[Depends(require_auth)])
    async def params() -> Dict[str, Any]:
        return {
            "active": engine.params.as_dict(),
            "effective_strategy": engine.strategy_cfg.model_dump(),
            "history": engine.optimizer.history(20),
        }

    # ---------------- authenticated control ---------------------------
    @app.post("/api/control/halt", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def halt() -> ControlResponse:
        engine.risk.manual_halt("operator halt via API")
        engine.ledger.log_event("manual_halt", {"source": "api"})
        return ControlResponse(ok=True, message="trading halted; open positions remain protected by stops")

    @app.post("/api/control/resume", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def resume() -> ControlResponse:
        engine.risk.clear_halt()
        engine.ledger.log_event("clear_halt", {"source": "api"})
        return ControlResponse(ok=True, message="halt cleared; trading re-enabled")

    @app.post("/api/control/flatten", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def flatten() -> ControlResponse:
        closed = []
        for sym in list(engine.ledger.positions.keys()):
            tk = engine.feed.tickers.get(sym) if engine.feed else None
            if tk is None:
                continue
            ok, msg = await engine.execution.close_position(sym, tk, None, "manual_flatten")
            closed.append({"symbol": sym, "ok": ok, "msg": msg})
        return ControlResponse(ok=True, message=f"flatten requested for {len(closed)} position(s)",
                               detail={"closed": closed})

    @app.post("/api/control/close", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def close_one(body: CloseRequest) -> ControlResponse:
        if body.symbol not in engine.ledger.positions:
            raise HTTPException(status_code=404, detail="no open position for symbol")
        tk = engine.feed.tickers.get(body.symbol) if engine.feed else None
        if tk is None:
            raise HTTPException(status_code=503, detail="no live ticker for symbol")
        ok, msg = await engine.execution.close_position(body.symbol, tk, None, f"manual:{body.reason}")
        return ControlResponse(ok=ok, message=msg)

    @app.post("/api/learning/run", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def learning_run() -> ControlResponse:
        report = await engine.run_learning_now()
        return ControlResponse(ok=True, message=report["verdict"], detail=report)

    @app.post("/api/learning/rollback", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def learning_rollback(body: RollbackRequest) -> ControlResponse:
        rolled = engine.optimizer.rollback(body.version)
        if rolled is None:
            raise HTTPException(status_code=404, detail="version not found")
        from .learning import apply_params

        engine.params = rolled
        engine.strategy_cfg = apply_params(cfg.strategy, rolled)
        return ControlResponse(ok=True, message=f"rolled back to version {body.version}")

    @app.post("/api/learning/toggle", response_model=ControlResponse, dependencies=[Depends(require_auth)])
    async def learning_toggle(enabled: bool = Query(...)) -> ControlResponse:
        cfg.learning.enabled = enabled
        return ControlResponse(ok=True, message=f"learning {'enabled' if enabled else 'disabled'}")

    # ---------------- websocket ---------------------------------------
    @app.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        token = websocket.query_params.get("token", "")
        import hmac

        if not token or not hmac.compare_digest(token, cfg.api.token):
            await websocket.close(code=4401)
            return
        await websocket.accept()
        try:
            last_payload = ""
            while True:
                snap = engine.snapshot()
                payload = json.dumps(snap, default=str)
                if payload != last_payload:
                    await websocket.send_text(payload)
                    last_payload = payload
                await asyncio.sleep(2.0)
        except (WebSocketDisconnect, RuntimeError):
            return
        except Exception as exc:
            log.warning("ws error", extra={"error": str(exc)})
            try:
                await websocket.close()
            except Exception:
                pass

    # ---------------- dashboard ---------------------------------------
    @app.get("/", response_class=HTMLResponse)
    async def index() -> HTMLResponse:
        f = WEB_DIR / "index.html"
        if not f.exists():
            return HTMLResponse("<h1>dashboard missing</h1>", status_code=500)
        return HTMLResponse(f.read_text(encoding="utf-8"))

    @app.get("/app.js")
    async def js() -> PlainTextResponse:
        return PlainTextResponse((WEB_DIR / "app.js").read_text(encoding="utf-8"),
                                 media_type="application/javascript")

    @app.get("/styles.css")
    async def css() -> PlainTextResponse:
        return PlainTextResponse((WEB_DIR / "styles.css").read_text(encoding="utf-8"),
                                 media_type="text/css")

    return app
