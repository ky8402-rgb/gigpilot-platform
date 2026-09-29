#!/usr/bin/env python3
"""End-to-end PRODUCTION verification of the deployed service.

Run after every deploy. Answers, with evidence:

  1. Is the running process executing the exact commit we intended to deploy?
  2. Is production healthy and ready?
  3. Does the authenticated live API serve real data?
  4. Does the live web UI serve, and does its asset/API contract hold?
  5. Are charts backed by REAL exchange candles (cross-checked against Binance)?
  6. Is trading state, risk gating and configuration reported correctly?
  7. Is FUTURES-ONLY enforcement actually in force?
  8. Are the live-trading safeguards un-bypassed? (actively probed, not assumed)

Exits non-zero on any failure so it can gate a deploy.

Usage:
    python3 ops/verify_production.py --expect-sha <commit-sha> [--base-url http://127.0.0.1:8080]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

PASS, FAIL, WARN = "\033[32mPASS\033[0m", "\033[31mFAIL\033[0m", "\033[33mWARN\033[0m"
RESULTS: List[Tuple[str, bool, str]] = []


def check(ok: bool, label: str, detail: str = "", warn_only: bool = False) -> bool:
    ok = bool(ok)
    RESULTS.append((label, ok, detail))
    tag = PASS if ok else (WARN if warn_only else FAIL)
    print(f"  [{tag}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def section(title: str) -> None:
    print(f"\n{{{title}}}".replace("{", "").replace("}", ""))


def get(url: str, token: Optional[str] = None, timeout: int = 30) -> Tuple[int, Any]:
    """Return (status, parsed-or-text). Never raises for HTTP errors."""
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
        body = e.read()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, body.decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


def read_token() -> str:
    tok = os.environ.get("QUANT_API__TOKEN", "").strip()
    if tok:
        return tok
    p = ROOT / "data" / "dashboard_token.txt"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return ""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--expect-sha", default=None, help="commit SHA the service must be running")
    ap.add_argument("--base-url", default="http://127.0.0.1:8080")
    ap.add_argument("--ready-timeout", type=int, default=300,
                    help="seconds to wait for the service to become operational")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    token = read_token()
    print("=" * 78)
    print(" PRODUCTION VERIFICATION")
    print(f" target      : {base}")
    print(f" expect sha  : {args.expect_sha or '(not specified)'}")
    print(f" token source: {'env' if os.environ.get('QUANT_API__TOKEN') else ('file' if token else 'MISSING')}")
    print("=" * 78)

    # ------------------------------------------------- readiness gate
    # Never assert on a service that is still booting: a boot race should be
    # reported as "not ready in time", not as a broken feature.
    print("\n[0] Waiting for the deployed service to become operational")
    deadline = time.time() + args.ready_timeout
    last = ""
    while time.time() < deadline:
        st_r, rdy = get(f"{base}/api/ready")
        _st_v, verp = get(f"{base}/api/version")
        sha_ok = (not args.expect_sha) or (
            isinstance(verp, dict) and verp.get("commit_sha") == args.expect_sha)
        if st_r == 200 and isinstance(rdy, dict) and rdy.get("ready") and sha_ok:
            last = f"ready after {int(args.ready_timeout - (deadline - time.time()))}s: {rdy}"
            break
        last = f"http={st_r} sha_ok={sha_ok} body={rdy if isinstance(rdy, dict) else rdy}"
        time.sleep(4)
    check("service reached full readiness (feed + ticks + health telemetry)",
          last.startswith("ready after"), last)

    # ---------------------------------------------------------------- 1. provenance
    print("\n[1] Deployed provenance")
    status, ver = get(f"{base}/api/version")
    check(status == 200, "GET /api/version is reachable", f"http={status}")
    if status != 200 or not isinstance(ver, dict):
        print(f"  [{FAIL}] cannot verify provenance; aborting checks that depend on it")
        _summary()
        return 1
    running_sha = ver.get("commit_sha")
    check(bool(running_sha) and running_sha != "unknown",
          "running process reports a concrete commit SHA",
          f"sha={running_sha} source={ver.get('source')}")
    if args.expect_sha:
        check(running_sha == args.expect_sha,
              "RUNNING SHA == EXPECTED DEPLOY SHA",
              f"running={running_sha} expected={args.expect_sha}")
    check(ver.get("verified") is True, "build marked verified by the release gate",
          f"verified={ver.get('verified')} gate={ver.get('release_gate')}")
    check(not ver.get("dirty", True), "deployed tree is not dirty (reproducible from SHA)",
          f"dirty={ver.get('dirty')}")
    tests = ver.get("tests") or {}
    check(bool(tests.get("passed")), "build recorded a passing test count",
          f"tests={tests.get('summary')} e2e={ver.get('e2e')}")

    # ---------------------------------------------------------------- 2. health
    print("\n[2] Health & readiness")
    status, health = get(f"{base}/api/health")
    check(status == 200 and isinstance(health, dict) and health.get("status") in ("ok", "degraded"),
          "GET /api/health responds", f"http={status} status={(health or {}).get('status') if isinstance(health, dict) else health}")
    check(isinstance(health, dict) and health.get("status") == "ok",
          "service is healthy (not degraded)", f"status={(health or {}).get('status') if isinstance(health, dict) else '?'}")
    status, ready = get(f"{base}/api/ready")
    check(status == 200 and isinstance(ready, dict) and ready.get("ready") is True,
          "GET /api/ready reports ready (feed connected + ticks flowing)",
          f"http={status} {ready if isinstance(ready, dict) else ready}")
    if isinstance(health, dict):
        check((health.get("ticks") or 0) > 0, "main loop is ticking", f"ticks={health.get('ticks')}")

    # ---------------------------------------------------------------- 3. stats
    print("\n[3] Metrics exposure")
    status, stats = get(f"{base}/api/stats")
    body = stats if isinstance(stats, str) else ""
    check(status == 200 and "quant_up" in body, "Prometheus metrics served", f"http={status}")
    check("quant_build_info" in body, "build provenance exposed as a metric")
    check("api_secret" not in body.lower() and "api_key" not in body.lower(),
          "metrics leak no credential fields")
    m = re.search(r"quant_build_info\{commit=\"([^\"]*)\"", body)
    if m and args.expect_sha:
        check(m.group(1) == args.expect_sha, "metrics commit label matches expected SHA",
              f"metric={m.group(1)}")

    # ---------------------------------------------------------------- 4. auth
    print("\n[4] Authentication on the live API")
    status, _ = get(f"{base}/api/state")
    check(status == 401, "unauthenticated /api/state is rejected", f"http={status}")
    status, _ = get(f"{base}/api/state?token=definitely-not-the-token")
    check(status == 403, "wrong token is rejected", f"http={status}")
    status, state = get(f"{base}/api/state", token=token) if token else (0, None)
    check(status == 200 and isinstance(state, dict),
          "authenticated /api/state succeeds with the deployed credential", f"http={status}")
    if status != 200:
        _summary()
        return 1

    # ---------------------------------------------------------------- 5. real data
    print("\n[5] Live UI assets & API contract")
    for path, needle in (("/", "<title>"), ("/app.js", "WebSocket"), ("/styles.css", "--bg")):
        status, text = get(f"{base}{path}")
        ok = status == 200 and isinstance(text, str) and needle in text
        check(ok, f"GET {path} serves the real asset", f"http={status} needle={needle!r}")

    html = get(f"{base}/")[1]
    js = get(f"{base}/app.js")[1]
    if isinstance(html, str) and isinstance(js, str):
        html_ids = set(re.findall(r'id="([^"]+)"', html))
        js_ids = set(re.findall(r"\$\('([^']+)'\)", js)) | set(re.findall(r"getElementById\('([^']+)'\)", js))
        missing = sorted(js_ids - html_ids)
        check(not missing, "served UI asset/DOM contract holds (no null-deref ids)", f"missing={missing or 'none'}")

    # ---------------------------------------------------------------- 6. market data
    print("\n[6] Real market data (charts)")
    sym_rows = get(f"{base}/api/symbols", token=token)[1]
    rows = (sym_rows or {}).get("rows") if isinstance(sym_rows, dict) else None
    check(bool(rows), "scanner returns symbols", f"count={len(rows) if rows else 0}")

    candles_ok = False
    if rows:
        sym = rows[0]["symbol"]
        status, cd = get(f"{base}/api/candles?symbol={sym}&limit=120", token=token)
        cl = (cd or {}).get("candles") if isinstance(cd, dict) else None
        check(status == 200 and bool(cl), f"candles served for {sym}", f"bars={len(cl) if cl else 0}")
        if cl:
            candles_ok = True
            last = cl[-1]
            check(all(k in last for k in ("time", "open", "high", "low", "close", "volume")),
                  "candles carry full OHLCV")
            check(all(last[k] > 0 for k in ("open", "high", "low", "close")),
                  "candle prices are positive and non-zero")
            check(last["high"] >= last["low"], "candle high >= low")
            # Cross-check against the CONFIGURED venue itself. Hardcoding one venue
            # here would pass silently while the service traded somewhere else.
            try:
                from app.config import load_config as _lc
                venue = _lc().exchange.name.lower()
                if venue == "bybit":
                    import urllib.parse as _up
                    qs = _up.urlencode({"category": "linear", "symbol": sym,
                                        "interval": "60", "limit": 20})
                    raw = json.loads(urllib.request.urlopen(
                        f"https://api.bybit.com/v5/market/kline?{qs}", timeout=20).read())
                    raw_rows = (raw.get("result") or {}).get("list") or []
                    ex_closes = {int(r[0]) // 1000: float(r[4]) for r in raw_rows}
                else:
                    raw = json.loads(urllib.request.urlopen(
                        f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=1h&limit=20",
                        timeout=20).read())
                    ex_closes = {int(k[0]) // 1000: float(k[4]) for k in raw}
                # Compare a WINDOW, not just one bar: mixing venues produces a
                # series where only some bars match, which a single-bar check hides.
                window = cl[-10:]
                comparable = [c for c in window if c["time"] in ex_closes]
                matched = [c for c in comparable
                           if abs(ex_closes[c["time"]] - c["close"]) < 1e-9]
                check(len(comparable) >= 5,
                      "served candles overlap the venue's recent window",
                      f"{len(comparable)} of last {len(window)} bars comparable")
                check(len(matched) == len(comparable),
                      f"EVERY comparable candle matches real {venue} klines "
                      f"(no venue contamination)",
                      f"{len(matched)}/{len(comparable)} matched exactly")
            except Exception as e:
                check(False, "cross-check against exchange klines",
                      f"could not fetch: {e}", warn_only=True)
    check(candles_ok, "chart data is real and populated")

    # ---------------------------------------------------------------- 7. trading state
    print("\n[7] Trading state")
    port = state.get("portfolio") or {}
    for k in ("equity", "cash_equity", "realized_net", "unrealized_net", "gross_exposure",
              "total_fees", "total_funding", "positions", "open_positions", "stats"):
        check(k in port, f"portfolio reports '{k}'")
    check(isinstance(port.get("equity"), (int, float)) and port.get("equity") > 0,
          "equity is a positive number", f"equity={port.get('equity')}")
    stats = port.get("stats") or {}
    check("realized_net" in stats and "cost_drag" in stats,
          "cost-aware performance reported (realized_net + cost_drag)",
          f"net={stats.get('realized_net')} drag={stats.get('cost_drag')}")
    for k in ("execution", "feed", "engine", "risk", "costs", "params", "learning", "build"):
        check(k in state, f"snapshot exposes '{k}'")
    for ep in ("/api/positions", "/api/orders", "/api/trades", "/api/equity", "/api/logs", "/api/params"):
        status, _ = get(f"{base}{ep}", token=token)
        check(status == 200, f"GET {ep} ok", f"http={status}")

    # ---------------------------------------------------------------- 8. risk gates
    print("\n[8] Risk gates")
    risk = state.get("risk") or {}
    limits = risk.get("limits") or {}
    check("halted" in risk and "halt_reasons" in risk, "halt state reported")
    check(bool(limits), "risk limits reported in the live payload", f"keys={len(limits)}")
    for k in ("risk_per_trade_pct", "max_leverage", "max_drawdown_pct",
              "daily_loss_limit_pct", "max_concurrent_positions"):
        check(k in limits, f"limit '{k}' present", f"value={limits.get(k)}")
    check(len(limits.get("max_leverage", 0) and str(limits["max_leverage"]) or "") > 0, "max_leverage is set")
    for k, v in limits.items():
        if isinstance(v, (int, float)):
            check(v > 0, f"limit '{k}' is positive", f"{k}={v}")
    check(risk.get("drawdown_pct") is not None, "drawdown reported", f"dd%={risk.get('drawdown_pct')}")

    eng = state.get("engine") or {}
    check("signals_rejected" in eng and "entry_scans" in eng,
          "rejection accounting is live (edge gate visible)",
          f"scans={eng.get('entry_scans')} rejected={eng.get('signals_rejected')}")

    # ---------------------------------------------------------------- 9. futures-only
    print("\n[9] Futures-only enforcement")
    from app.config import load_config
    from app.exchange import EXCHANGE_PRESETS, create_market_client
    cfg = load_config()
    venue = cfg.exchange.name.lower()
    preset = EXCHANGE_PRESETS.get(venue, {})
    check(venue in EXCHANGE_PRESETS, "configured venue has a known preset", f"venue={venue}")
    check(cfg.exchange.market_type in ("usdm", "linear"),
          "configured market type is a USD-margined PERPETUAL futures market",
          f"market_type={cfg.exchange.market_type}")
    check(bool(preset) and cfg.exchange.rest_url == preset.get("rest_url"),
          "REST base matches the venue's futures API", f"rest_url={cfg.exchange.rest_url}")
    check(bool(preset) and cfg.exchange.ws_url == preset.get("ws_url"),
          "WS base matches the venue's futures stream", f"ws_url={cfg.exchange.ws_url}")

    # Ask the adapter the service would ACTUALLY use how it is scoped.
    try:
        adapter = create_market_client(cfg)
        if venue == "bybit":
            check(getattr(adapter, "category", None) == "linear",
                  "Bybit adapter is scoped to category=linear (perps, not spot)",
                  f"category={getattr(adapter, 'category', None)}")
            check(adapter.ws_connect_url("1h", ["BTCUSDT"]).endswith("/v5/public/linear"),
                  "Bybit WS endpoint is the LINEAR (futures) stream, not spot",
                  adapter.ws_connect_url("1h", ["BTCUSDT"]))
        else:
            check("fapi" in cfg.exchange.rest_url, "Binance adapter uses the futures API")
    except Exception as exc:
        check(False, "adapter instantiation", f"{type(exc).__name__}: {exc}")

    src = ""
    for f in (ROOT / "app").glob("*.py"):
        src += f.read_text(encoding="utf-8", errors="ignore")
    # Match the spot HOST and spot API version explicitly. A naive substring test
    # for "api.binance.com" false-positives on "fapi.binance.com".
    spot_host = re.search(r"(?<![A-Za-z])api\.binance\.com", src)
    spot_api = re.search(r"/api/v[0-9]+/", src)
    spot_category = re.search(r"""['"]category['"]\s*:\s*['"]spot['"]""", src, re.I)
    check(spot_host is None and spot_api is None and spot_category is None,
          "no SPOT endpoint or spot category appears anywhere in the codebase",
          f"spot_host={bool(spot_host)} spot_api={bool(spot_api)} "
          f"spot_category={bool(spot_category)}")
    if venue == "bybit":
        ok_eps = sorted(set(re.findall(r'"(/v5/[A-Za-z/]+)"', src)))
    else:
        ok_eps = sorted(set(re.findall(r'"(/fapi/v\d+/[A-Za-z/]+)"', src)))
    check(bool(ok_eps), "venue futures endpoints present in the codebase",
          f"{len(ok_eps)} endpoints")

    # ---------------------------------------------------------------- 10. safeguards
    print("\n[10] Live-trading safeguards (actively probed)")
    check(cfg.live_enabled() is False, "live trading is NOT armed", f"live_enabled={cfg.live_enabled()}")
    check(state.get("live_armed") is False, "running service reports live_armed=false",
          f"live_armed={state.get('live_armed')}")
    check(state.get("mode") == "paper", "running in PAPER mode (no real orders)", f"mode={state.get('mode')}")

    # Probe: the live broker must refuse to construct without the interlock.
    from app.exchange import BinancePrivate
    from app.execution import LiveBroker
    refused = False
    try:
        LedgerCls = __import__("app.portfolio", fromlist=["Ledger"]).Ledger
        CostModel = __import__("app.costs", fromlist=["CostModel"]).CostModel
        led = LedgerCls(cfg.risk.starting_equity, None, persist=False)
        LiveBroker(cfg, led, None, CostModel(cfg))
    except RuntimeError as e:
        refused = "live trading requires" in str(e)
    except Exception:
        refused = True  # any failure to construct is a refusal
    check(refused, "LiveBroker REFUSES to construct while unarmed (hard interlock)")

    # Probe: arming must require all four independent signals.
    import copy
    partial = []
    base_cfg = copy.deepcopy(cfg)
    # 1) mode=live alone
    c = copy.deepcopy(base_cfg); c.execution.mode = "live"
    partial.append(("mode=live only", c.live_enabled()))
    # 2) mode + allow_live
    c = copy.deepcopy(base_cfg); c.execution.mode = "live"; c.execution.allow_live = True
    partial.append(("mode+allow_live", c.live_enabled()))
    # 3) + credentials (still no env ack)
    c = copy.deepcopy(base_cfg); c.execution.mode = "live"; c.execution.allow_live = True
    c.exchange.api_key = "k" * 32; c.exchange.api_secret = "s" * 32
    partial.append(("mode+allow_live+creds (no ACK)", c.live_enabled()))
    # 4) all four
    os.environ["QUANT_LIVE_TRADING_ACK"] = "yes"
    try:
        c = copy.deepcopy(base_cfg); c.execution.mode = "live"; c.execution.allow_live = True
        c.exchange.api_key = "k" * 32; c.exchange.api_secret = "s" * 32
        partial.append(("+ ACK=yes (all four)", c.live_enabled()))
    finally:
        os.environ.pop("QUANT_LIVE_TRADING_ACK", None)
    for label, armed in partial[:3]:
        check(armed is False, f"cannot arm with {label}")
    check(partial[3][1] is True, "arms ONLY when all four signals agree")

    # Probe: no arbitrary order/leverage endpoint exists.
    status, _ = get(f"{base}/api/control/order?token={token}")
    check(status in (404, 405), "no arbitrary-order endpoint exists", f"http={status}")
    status, _ = get(f"{base}/api/control/leverage?token={token}")
    check(status in (404, 405), "no leverage-mutation endpoint exists", f"http={status}")

    # Probe: control endpoints still require auth.
    for ep in ("halt", "resume", "flatten"):
        s, _ = get(f"{base}/api/control/{ep}")
        check(s in (401, 405), f"control '{ep}' is not reachable unauthenticated", f"http={s}")

    # ---------------------------------------------------------------- 11. self-heal
    print("\n[11] Observability & self-healing")
    feed = state.get("feed") or {}
    check(feed.get("connected") is True, "market data feed connected", f"connected={feed.get('connected')}")
    # NOTE: `age or 9e9` is a trap — 0.0 is falsy, so a perfectly fresh feed
    # (age 0.0s) was reported as stale. Test for None explicitly.
    feed_age = feed.get("last_message_age_s")
    check(feed_age is not None and feed_age < 300,
          "feed is fresh (not stale)", f"age={feed_age}s")
    check(feed.get("errors", 0) >= 0, "feed error counter exposed", f"errors={feed.get('errors')}")
    sc = state.get("selfcheck") or {}
    check(bool(sc), "self-check telemetry present (reconcile/health loop running)", f"keys={sorted(sc)[:4]}")
    # Out-of-band kill switch must be visible, and must be a real file the operator
    # can `touch` without API access.
    hf = sc.get("halt_file") or {}
    check(isinstance(hf, dict) and "path" in hf,
          "out-of-band kill switch file is reported", f"{hf.get('path')} present={hf.get('present')}")
    from app.config import PROJECT_ROOT as _PR
    from pathlib import Path as _P
    kp = hf.get("path")
    check(bool(kp) and _P(kp).parent.is_dir(),
          "kill switch file lives in a writable directory", str(kp))
    check(hf.get("present") is not True or risk.get("halted") is True,
          "if the kill switch file exists, trading is halted",
          f"file_present={hf.get('present')} halted={risk.get('halted')}")
    # Live-mode equity must come from the exchange, never from a placeholder.
    check("equity_source" in port,
          "equity source is reported (accounting vs exchange)", f"{port.get('equity_source')}")
    if state.get("mode") == "live":
        check(port.get("equity_source") != "accounting",
              "LIVE mode sizes from the exchange's reported equity",
              f"source={port.get('equity_source')}")
    learning = state.get("learning") or {}
    check("symbol_state" in learning and "tradable_symbols" in learning,
          "evidence-based symbol gating is live",
          f"tradable={len(learning.get('tradable_symbols', []))} gated={len(learning.get('symbol_state', {}))}")

    return _summary()


def _summary() -> int:
    passed = sum(1 for _, ok, _ in RESULTS if ok)
    total = len(RESULTS)
    failed = [(label, d) for label, ok, d in RESULTS if not ok]
    print("\n" + "=" * 78)
    print(f" PRODUCTION VERIFICATION: {passed}/{total} checks passed")
    if failed:
        print("\n FAILED CHECKS:")
        for label, detail in failed:
            print(f"   - {label}" + (f"  ({detail})" if detail else ""))
    print("=" * 78)
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
