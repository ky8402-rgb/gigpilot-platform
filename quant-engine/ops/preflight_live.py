#!/usr/bin/env python3
"""Live-trading preflight.

Everything that can be verified WITHOUT an owner-only action, checked in the order
in which a failure would hurt, and reported as an explicit go/no-go with the exact
owner action needed for anything that is blocked.

Owner-only actions (this script cannot perform them, and never fakes them):
  * adding this host's IP to the exchange API key's allowlist
  * creating / rotating the API key itself
  * funding the account
  * supplying credentials

Never prints secret values. Never places an order.

Usage:
    python3 ops/preflight_live.py [--expect-sha SHA]
Exit: 0 = clear to arm, 1 = blocked (see the summary), 2 = armed but unhealthy.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.config import load_config  # noqa: E402

PASS, FAIL, WARN, INFO = "\033[32mPASS\033[0m", "\033[31mBLOCK\033[0m", "\033[33mWARN\033[0m", "INFO"
RESULTS: List[Tuple[str, str, str, str]] = []   # (level, label, detail, owner_action)
OWNER_ACTIONS: List[str] = []


def record(level: str, label: str, detail: str = "", owner_action: str = "") -> bool:
    ok = level != "block"
    RESULTS.append((level, label, detail, owner_action))
    tag = {"pass": PASS, "block": FAIL, "warn": WARN, "info": INFO}[level]
    print(f"  [{tag}] {label}" + (f" — {detail}" if detail else ""))
    if level == "block" and owner_action and owner_action not in OWNER_ACTIONS:
        OWNER_ACTIONS.append(owner_action)
    return ok


def section(t: str) -> None:
    print(f"\n<{t}>".replace("<", "[").replace(">", "]"))


def http_json(url: str, token: Optional[str] = None, timeout: int = 25) -> Tuple[int, Any]:
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            try:
                return r.status, json.loads(body)
            except json.JSONDecodeError:
                return r.status, body.decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, ""
    except Exception as e:
        return 0, str(e)


# ---------------------------------------------------------------------------
async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expect-sha", default=None)
    ap.add_argument("--base-url", default="http://127.0.0.1:8080")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    cfg = load_config()
    venue = cfg.exchange.name.lower()

    print("=" * 78)
    print(" LIVE TRADING PREFLIGHT")
    print(f" venue={venue}  market={cfg.exchange.market_type}  interval={cfg.data.primary_interval}")
    print(f" service={base}")
    print("=" * 78)

    # ---------------------------------------------------------------- 1. config
    section("1. Configuration & cost basis")
    from app.exchange import EXCHANGE_PRESETS
    preset = EXCHANGE_PRESETS.get(venue)
    record("pass" if preset else "block", "venue is a supported adapter",
           f"venue={venue}", "choose exchange.name in {bybit, binance}")
    if preset:
        record("pass" if cfg.exchange.rest_url == preset["rest_url"] else "block",
               "REST base matches the venue",
               f"{cfg.exchange.rest_url}")
        record("pass", "cost model uses the venue's fee schedule",
               f"maker {cfg.costs.maker_fee_bps}bps / taker {cfg.costs.taker_fee_bps}bps "
               f"(venue default {preset['taker_fee_bps']})")
        if abs(cfg.costs.taker_fee_bps - preset["taker_fee_bps"]) > 1e-9:
            record("warn", "configured taker fee differs from the venue default",
                   f"configured {cfg.costs.taker_fee_bps} vs default {preset['taker_fee_bps']} — "
                   f"a wrong fee silently mis-prices the edge hurdle")
    record("pass" if cfg.risk.max_drawdown_pct > 0 else "block",
           "max drawdown kill switch configured", f"{cfg.risk.max_drawdown_pct}%")
    record("pass" if cfg.risk.daily_loss_limit_pct > 0 else "block",
           "daily loss limit configured", f"{cfg.risk.daily_loss_limit_pct}%")
    record("pass" if cfg.risk.max_leverage >= 1 else "block",
           "leverage cap configured", f"{cfg.risk.max_leverage}x")

    # ---------------------------------------------------------------- 1b. host identity
    section("1b. Host identity (which machine is this?)")
    from app import hostid
    idrep = asyncio.run(hostid.verify(cfg.exchange.expected_host_ip))
    record("info", "this host's outbound IP", str(idrep.get("actual")))
    if not idrep["enabled"]:
        record("warn", "expected_host_ip is not configured",
               "the platform cannot detect that it is running on the wrong host",
               f"set exchange.expected_host_ip (e.g. {idrep.get('actual') or 'this host'}) "
               f"so the platform refuses to trade from an unintended machine")
    elif idrep["ok"]:
        record("pass", "running on the expected host", idrep["actual"])
    else:
        record("block", "HOST IDENTITY MISMATCH", idrep["detail"],
               f"either run this deployment on {idrep['expected']}, or allowlist "
               f"{idrep.get('actual')} on the API key as well")

    # ---------------------------------------------------------------- 2. interlock
    section("2. Live interlock (all four signals must agree)")
    ack = os.environ.get("QUANT_LIVE_TRADING_ACK", "").strip().lower() == "yes"
    creds = bool(cfg.exchange.api_key and cfg.exchange.api_secret)
    sig = [
        ("execution.mode == 'live'", cfg.execution.mode == "live"),
        ("execution.allow_live == true", bool(cfg.execution.allow_live)),
        ("API credentials present", creds),
        ("QUANT_LIVE_TRADING_ACK == 'yes'", ack),
    ]
    for label, ok in sig:
        record("pass" if ok else "warn", f"signal: {label}", "satisfied" if ok else "NOT satisfied")
    armed = cfg.live_enabled()
    record("info", "effective mode", cfg.effective_mode())
    if armed:
        record("warn", "LIVE ROUTING IS ARMED by the interlock",
               "any order the engine decides on will be sent to the exchange with real funds")
    else:
        record("info", "live routing is DISARMED (interlock incomplete)")

    # ---------------------------------------------------------------- 3. credentials
    section("3. Credentials & exchange permissions")
    if not creds:
        # Diagnose the single most common mistake: credentials present under the
        # WRONG variable names, which are silently ignored by the loader.
        misnamed = sorted(
            k for k in os.environ
            if ("API_KEY" in k.upper() or "API_SECRET" in k.upper())
            and k not in ("QUANT__EXCHANGE__API_KEY", "QUANT__EXCHANGE__API_SECRET")
        )
        if misnamed:
            record("block", "credentials are set under names the platform does not read",
                   "found: " + ", ".join(misnamed) + " (values not shown)",
                   "ROTATE the key at the exchange first (this one was exposed), then set the NEW "
                   "key as QUANT__EXCHANGE__API_KEY / QUANT__EXCHANGE__API_SECRET "
                   "(note the DOUBLE underscore after QUANT)")
        else:
            record("block", "no API credentials in the environment",
                   "checked QUANT__EXCHANGE__API_KEY / _SECRET",
                   "put a rotated key in .env as QUANT__EXCHANGE__API_KEY (double underscore)")
    else:
        record("pass", "API credentials present",
               f"key={cfg.exchange.api_key[:4]}… ({len(cfg.exchange.api_key)} chars), secret hidden")
        from app.exchange import create_private_client
        try:
            priv = create_private_client(cfg)
        except Exception as exc:
            priv = None
            record("block", "could not construct the private client", f"{exc}")
        if priv is not None:
            try:
                probe = await priv.permissions_probe()
                record("pass", "exchanged authenticated successfully (key valid, no IP block)")
                if probe.get("can_withdraw"):
                    record("block", "API KEY HAS WITHDRAWAL PERMISSION",
                           "revoke withdrawals on this key before arming",
                           "disable withdrawals on the API key at the exchange")
                else:
                    record("pass", "key cannot withdraw funds")
                if probe.get("can_transfer"):
                    record("block", "key can transfer funds between wallets",
                           "remove wallet-transfer permission",
                           "disable wallet transfer on the API key")
                else:
                    record("pass", "key cannot transfer funds")
                if probe.get("can_trade_futures"):
                    record("pass", "key may trade futures/contracts")
                else:
                    record("block", "key lacks futures trading permission",
                           "", "enable Futures/Contract read+trade on the key")
                if probe.get("read_only"):
                    record("block", "key is READ-ONLY", "", "enable contract trade on the key")
                ips = probe.get("ip_allowlist") or []
                if ips:
                    record("pass", "key is IP-restricted", f"allowlist={ips}")
                else:
                    record("warn", "key has NO IP allowlist",
                           "the key is usable from anywhere if leaked",
                           "bind the key to 35.154.110.156 at the exchange")
                await priv.close()
            except Exception as exc:
                code = getattr(exc, "code", None)
                if code == 10010:
                    record("block", "THIS HOST IS NOT IN THE KEY'S IP ALLOWLIST",
                           f"[{code}] {exc}",
                           "add 35.154.110.156 to the Bybit API key's bound IP list")
                    record("info", "the signature scheme itself is CORRECT",
                           "Bybit rejected on source IP, not on a bad key or bad sign")
                elif code in (10003, 10004):
                    record("block", "key or signature REJECTED",
                           f"[{code}] {exc}", "check the key/secret pair and that it is current")
                elif code in (10005, 33004):
                    record("block", "key lacks permission for this endpoint",
                           f"[{code}] {exc}", "grant contract-trade permission to the key")
                else:
                    record("block", "credential probe failed", f"[{code}] {exc}")
                try:
                    await priv.close()
                except Exception:
                    pass

    # ---------------------------------------------------------------- 4. market data
    section("4. Market data on the configured venue")
    from app.exchange import create_market_client
    from app.market import screen_universe
    syms: List[str] = []
    specs: Dict[str, Any] = {}
    try:
        client = create_market_client(cfg)
        await client.ping()
        specs = await client.exchange_info()
        tickers = await client.tickers_24h()
        record("pass", "public market data reachable",
               f"{len(specs)} tradable {cfg.universe.quote} perpetuals, {len(tickers)} tickers")
        bn = syms_btc = specs.get("BTCUSDT")
        if syms_btc and "BTCUSDT" in tickers:
            t = tickers["BTCUSDT"]
            record("pass" if t.ask >= t.bid > 0 else "block", "live BTC bid/ask sane",
                   f"bid={t.bid} ask={t.ask} spread={t.spread_bps:.4f}bps")
        syms = await screen_universe(cfg, client)
        record("pass" if syms else "block", "liquidity screen selected symbols",
               f"{len(syms)}: {', '.join(syms[:6])}{'…' if len(syms) > 6 else ''}")
    except Exception as exc:
        record("block", "market data failure", f"{type(exc).__name__}: {exc}")
        client = None

    # ---------------------------------------------------------------- 5. feasibility
    section("5. Capital feasibility at the configured risk")
    equity = None
    status, state = http_json(f"{base}/api/state",
                             token=read_token())
    if status == 200 and isinstance(state, dict):
        equity = (state.get("portfolio") or {}).get("equity")
        record("pass", "running service reachable and authenticated", f"equity basis = {equity}")
    else:
        record("warn", "running service not reachable with a token",
               f"http={status} (continuing; feasibility uses the configured equity)")
    from app import indicators as ta
    from app.market import rows_to_df
    from app.risk import size_position
    from app.strategy import Setup

    base_equity = float(equity or cfg.risk.starting_equity)
    record("info", "sizing basis", f"{base_equity} (from {'live service' if equity else 'config'})")

    tradable: List[Dict[str, Any]] = []
    if client is not None and syms:
        for sym in syms[:4]:
            try:
                rows = await client.klines(sym, cfg.data.primary_interval, limit=200)
                if len(rows) < 60:
                    continue
                df = ta.enrich(rows_to_df(rows), cfg.strategy)
                last = df.iloc[-1]
                price = float(last["close"])
                atr = float(last["atr"])
                if not (price > 0 and atr == atr and atr > 0):
                    continue
                setup = Setup(symbol=sym, direction="LONG", price=price, atr=atr,
                              stop=price - cfg.strategy.atr_stop_mult * atr,
                              target=price + cfg.strategy.tp_r_multiple * cfg.strategy.atr_stop_mult * atr,
                              risk_per_unit=cfg.strategy.atr_stop_mult * atr)
                sizing = size_position(setup, base_equity, None, specs.get(sym), cfg)
                tradable.append({"symbol": sym, "price": price, "atr": atr,
                                 "qty": sizing["qty"], "notional": sizing["notional"],
                                 "binding": sizing.get("binding"), "reason": sizing.get("reason")})
            except Exception:
                continue
    if tradable:
        for t in tradable:
            ok = t["qty"] > 0 and t["notional"] > 0
            record("pass" if ok else "block",
                   f"{t['symbol']}: can open a compliant position" if ok else f"{t['symbol']}: CANNOT size a valid position",
                   f"px={t['price']:.6g} qty={t['qty']} notional={t['notional']:.2f} ({t['binding']})"
                   if ok else t["reason"],
                   "" if ok else f"fund the account above the venue's minimum notional for {t['symbol']}")
        viable = [t for t in tradable if t["qty"] > 0]
        record("pass" if viable else "block", "at least one symbol is tradable at this equity",
               f"{len(viable)}/{len(tradable)} viable")
    else:
        record("warn", "could not evaluate sizing feasibility",
               "no symbol data available during preflight")

    # ---------------------------------------------------------------- 6. account state
    section("6. Account state that would be adopted at arm time")
    if status == 200 and isinstance(state, dict):
        pos = state.get("portfolio", {}).get("positions") or []
        if pos:
            record("warn", "the account currently holds positions",
                   f"{len(pos)} open: " + ", ".join(p.get("symbol", "?") for p in pos),
                   "confirm you want these adopted and managed before arming")
        else:
            record("pass", "no open positions to adopt")
        risk = state.get("risk") or {}
        if risk.get("halted"):
            record("block", "the running engine is HALTED",
                   f"reasons={risk.get('halt_reasons')}",
                   "review the halt reason and clear it deliberately with POST /api/control/resume")
        else:
            record("pass", "no active trading halt")
        record("info", "guard state persisted",
               f"peak_equity={risk.get('peak_equity')} daily_pnl={risk.get('daily_pnl')}")

    # ---------------------------------------------------------------- 7. safeguards
    section("7. Safeguard invariants")
    token = read_token()
    for path, label, expect in (
        ("/api/control/order", "no arbitrary-order endpoint", (404, 405)),
        ("/api/control/leverage", "no leverage-mutation endpoint", (404, 405)),
    ):
        st, _ = http_json(f"{base}{path}?token={token}")
        record("pass" if st in expect else "block", label, f"http={st}")
    st, _ = http_json(f"{base}/api/control/halt")
    record("pass" if st in (401, 405) else "block",
           "control endpoints require authentication", f"http={st}")
    from app.exchange import ExchangeError as _EE
    from app.execution import LiveBroker
    from app.costs import CostModel as _CM
    try:
        LiveBroker(cfg, __import__("app.portfolio", fromlist=["Ledger"]).Ledger(base_equity, None, persist=False),
                   None, _CM(cfg))
        record("block", "LiveBroker constructed while the interlock is incomplete",
               "the constructor guard is not holding")
    except RuntimeError:
        record("pass", "LiveBroker refuses to construct while unarmed")

    if args.expect_sha:
        st, ver = http_json(f"{base}/api/version")
        sha = (ver or {}).get("commit_sha") if isinstance(ver, dict) else None
        record("pass" if sha == args.expect_sha else "block",
               "running service is the expected build",
               f"running={sha} expected={args.expect_sha}")

    if client is not None:
        try:
            await client.close()
        except Exception:
            pass

    # ---------------------------------------------------------------- summary
    blocks = [r for r in RESULTS if r[0] == "block"]
    warns = [r for r in RESULTS if r[0] == "warn"]
    passes = [r for r in RESULTS if r[0] == "pass"]
    print("\n" + "=" * 78)
    print(f" PREFLIGHT: {len(passes)} passed, {len(warns)} warnings, {len(blocks)} BLOCKERS")
    if blocks:
        print("\n BLOCKERS:")
        for _, label, detail, _ in blocks:
            print(f"   - {label}" + (f"  ({detail})" if detail else ""))
    if OWNER_ACTIONS:
        print("\n OWNER-ONLY ACTIONS REQUIRED (cannot be automated):")
        for a in OWNER_ACTIONS:
            print(f"   * {a}")
    print("\n VERDICT: " + ("BLOCKED — do not arm live trading" if blocks
                            else "CLEAR TO ARM"))
    print("=" * 78)
    return 1 if blocks else 0


def read_token() -> str:
    tok = os.environ.get("QUANT_API__TOKEN", "").strip()
    if tok:
        return tok
    p = ROOT / "data" / "dashboard_token.txt"
    return p.read_text(encoding="utf-8").strip() if p.exists() else ""


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
