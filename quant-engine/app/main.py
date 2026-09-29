"""Entrypoint: start the trading engine and the API/dashboard together.

Both run in one process so that a crash takes the whole system down and the
supervisor restarts it cleanly — a half-alive process (engine trading, API dead,
or vice versa) is worse than a dead one.
"""
from __future__ import annotations

import argparse
import asyncio
import signal
import sys
from pathlib import Path

import uvicorn

from .api import create_app
from .config import get_config, load_config, PROJECT_ROOT, redact
from .engine import TradingEngine
from .logging_setup import get_logger, setup_logging

log = get_logger("main")


async def run(cfg) -> None:
    engine = TradingEngine(cfg)
    app = create_app(engine)

    server = uvicorn.Server(
        uvicorn.Config(
            app,
            host=cfg.api.host,
            port=cfg.api.port,
            log_level=cfg.log_level.lower(),
            access_log=False,
            timeout_keep_alive=30,
            # The engine's tick loop must not be starved by request handling.
            limit_concurrency=200,
        )
    )

    stop_event = asyncio.Event()

    def _signal(*_: object) -> None:
        log.warning("shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _signal)
        except NotImplementedError:  # pragma: no cover
            pass

    await engine.start()
    log.warning(
        "DASHBOARD READY",
        extra={
            "url": f"http://{cfg.api.host}:{cfg.api.port}/",
            "token_hint": "see data/dashboard_token.txt or the QUANT_API__TOKEN env var",
            "mode": engine.mode,
        },
    )

    server_task = asyncio.create_task(server.serve())
    stop_task = asyncio.create_task(stop_event.wait())
    try:
        await asyncio.wait({server_task, stop_task}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        server.should_exit = True
        await engine.stop()
        server_task.cancel()
        stop_task.cancel()
        await asyncio.gather(server_task, stop_task, return_exceptions=True)
        log.info("shutdown complete")


def main() -> int:
    parser = argparse.ArgumentParser(description="Futures quant trading platform")
    parser.add_argument("--config", type=Path, default=None, help="path to config.yaml")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", type=str, default=None)
    parser.add_argument("--log-level", type=str, default=None)
    parser.add_argument("--check", action="store_true", help="validate config and exit")
    args = parser.parse_args()

    cfg = load_config(args.config)
    if args.port:
        cfg.api.port = args.port
    if args.host:
        cfg.api.host = args.host
    if args.log_level:
        cfg.log_level = args.log_level

    setup_logging(cfg.log_level, cfg.log_json, PROJECT_ROOT / "data" / "logs")

    if args.check:
        print("config OK")
        print(f"  mode            : {cfg.effective_mode()}")
        print(f"  live_armed      : {cfg.live_enabled()}")
        print(f"  interval        : {cfg.data.primary_interval}")
        print(f"  api_key         : {redact(cfg.exchange.api_key)}")
        print(f"  api_secret      : {redact(cfg.exchange.api_secret)}")
        print(f"  dashboard port  : {cfg.api.port}")
        print(f"  token           : {'set' if cfg.api.token else 'unset'}")
        return 0

    log.warning(
        "booting",
        extra={"mode": cfg.effective_mode(), "interval": cfg.data.primary_interval,
               "live_armed": cfg.live_enabled()},
    )
    try:
        asyncio.run(run(cfg))
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        log.error("fatal", extra={"error": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
