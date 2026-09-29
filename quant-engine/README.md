# Futures Quant Platform

A production-oriented automated perpetual-futures trading platform: real market
data, an explicit cost model that can veto any trade, layered risk controls that
fail closed, walk-forward learning that refuses to promote on weak evidence, a live
dashboard, and operational tooling.

**Venues:** Bybit v5 (`category=linear`) and Binance USDⓈ-M (`usdm`). Both sit
behind one normalised adapter interface, so strategy, risk, cost and execution code
is venue-agnostic. Only USD-margined perpetual futures are supported on either.

**Current state: PAPER mode.** The platform is running against **real** exchange
data — real prices, real candles, real order books, real funding rates — with
simulated fills and full cost accounting. No order has been or will be sent to an
exchange until the operator supplies credentials and explicitly arms live trading
(see [Going live](#going-live)).

---

## Why this exists

Most retail futures "strategies" lose money to costs, not to bad signals. A signal
is not a trade. This platform encodes that as a hard rule:

> A setup becomes an order **only** when its empirically estimated gross edge
> exceeds the **fully loaded round-trip cost** (fees + slippage + spread +
> funding + adverse selection) by the configured hurdle multiple (default 2×),
> and **only** when that edge is statistically distinguishable from zero
> (t-stat ≥ 1.0 over ≥ 10 trades), and **only** for symbols with positive
> out-of-sample expectancy.

If those conditions are not met, the correct action is DO NOTHING — and the
dashboard says so, with the numbers that produced the decision.

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   Bybit v5 perp    │  market.py                                   │
   REST + WebSocket │  CandleStore (SQLite) · MarketFeed (ws+rest)  │
                    └───────────────┬──────────────────────────────┘
                                    │ closed-bar events only
                    ┌───────────────▼──────────────────────────────┐
                    │  strategy.py     regime → setup → edge        │
                    │  indicators.py   causal, no look-ahead        │
                    └───────────────┬──────────────────────────────┘
                                    │ setup + empirical EdgeStats
                    ┌───────────────▼──────────────────────────────┐
                    │  costs.py    fees·slip·spread·funding·adverse │
                    │  ── HURDLE GATE: gross edge ≥ 2× cost ──      │
                    └───────────────┬──────────────────────────────┘
                                    │ approved size + levels
                    ┌───────────────▼──────────────────────────────┐
                    │  risk.py     sizing · exposure · kill switch  │
                    └───────────────┬──────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────────┐
                    │  execution.py  PaperBroker | LiveBroker       │
                    │  portfolio.py  ledger · net PnL · SQLite      │
                    └───────────────┬──────────────────────────────┘
                                    │
        ┌───────────────────────────┴──────────────────────────────┐
        │  engine.py    tick loop · health/self-heal · learning     │
        └───────────────────────────┬──────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────────────────┐
                    │  api.py  REST + WS + auth   ·   web/ dashboard│
                    └──────────────────────────────────────────────┘
```

### Module map

| File | Responsibility |
|---|---|
| `app/config.py` | Layered config (defaults → YAML → env). Secrets are env-only. |
| `app/logging_setup.py` | Structured logging, credential redaction, in-memory ring buffer for the UI. |
| `app/indicators.py` | Vectorised, strictly causal indicators (EMA/ATR/ADX/RSI/MACD/Donchian/BB/z/vol). |
| `app/exchange.py` | Shared normalised models, fee presets, and the Binance USDⓈ-M adapter (`BinanceFutures` public / `BinancePrivate` signed), plus the venue factories that select an adapter. The Bybit adapter lives in `app/bybit.py`; `exchange.name` picks which one is used. |
| `app/bybit.py` | Bybit v5 linear-perp adapter (`BybitClient` public / `BybitPrivate` signed). Handles Bybit's descending string klines, fractional 24h change, paginated instruments and UUID order ids. |
| `app/market.py` | Candle store + self-healing ws feed (venue-agnostic via the adapter's WS contract) + REST reconciler + universe screener. |
| `app/costs.py` | Cost model: real-book slippage walk, fees, funding, adverse selection, hurdle. |
| `app/strategy.py` | Regime detection, entry rules, shared simulator, empirical edge estimation, decision. |
| `app/risk.py` | Volatility-targeted sizing, exposure caps, daily-loss/drawdown/streak circuit breakers. |
| `app/execution.py` | `PaperBroker` (pessimistic fills), `LiveBroker` (guarded), position lifecycle. |
| `app/portfolio.py` | Ledger: positions, orders, trades, honest cost accounting, SQLite durability. |
| `app/learning.py` | Walk-forward optimiser, promotion on OOS evidence, rollback, per-symbol gating. |
| `app/engine.py` | Orchestration: tick loop, health/self-healing, learning scheduler. |
| `app/api.py` | FastAPI: REST + WebSocket, bearer auth, rate limiting, Prometheus metrics. |
| `app/web/` | Dependency-free dashboard (custom canvas candlestick renderer). |

---

## Quick start

```bash
pip install -r requirements.txt

# validate configuration and see the effective mode
python3 -m app.main --check

# run (foreground)
bash ops/run.sh

# run under a restart supervisor
bash ops/watchdog.sh
```

Then open `http://<host>:8080/` and paste the token from
`data/dashboard_token.txt` (created on first boot with `0600` permissions).

### Verify it works

```bash
python3 -m pytest tests/ -q      # 230 unit tests, offline
python3 ops/e2e_check.py         # 30 end-to-end checks against LIVE data
bash ops/healthcheck.sh          # liveness/readiness probe (exit 2 = degraded)
bash ops/backup.sh               # online SQLite backup + 14-snapshot rotation
```

---

## Going live

Live order routing requires **four independent signals** to agree. This is
deliberate: no single mistake can arm the account.

1. `execution.mode: live` in `config/config.yaml`
2. `execution.allow_live: true` in `config/config.yaml`
3. `QUANT_EXCHANGE__API_KEY` and `QUANT_EXCHANGE__API_SECRET` set in `.env`
4. `QUANT_LIVE_TRADING_ACK=yes` in the environment

```bash
cp .env.example .env
# edit .env with your keys
```

**Key hygiene (enforced by policy, verified at arm time):**
- Enable **Futures / Contract: Read + Trade** only. **Never** enable withdrawals
  or wallet transfer.
- Bind the API key to this server's IP.
- Use a sub-account funded with only what you are willing to lose.

The platform **refuses to arm** if the key it is handed can withdraw or transfer
funds, or lacks contract-trading permission. On Bybit this is read from
`/v5/user/query-api`; the probe result is logged at startup.

### Bybit
```bash
# .env — the loader expects the QUANT__EXCHANGE__ prefix (double underscore)
QUANT__EXCHANGE__API_KEY=...
QUANT__EXCHANGE__API_SECRET=...
```
Set `exchange.name: bybit` in `config/config.yaml`. Bybit's standard taker fee is
**5.5 bps** (vs Binance's 5.0) and is already reflected in the cost model.

Add this host's outbound IP to the key's allowlist, or Bybit returns
`retCode 10010 Unmatched IP` on every signed call.

> An API key that cannot withdraw is a key that cannot be stolen from. This is the
> single highest-leverage security control available, and it costs nothing.

Verify the arm state without trading:

```bash
python3 -m app.main --check    # shows live_armed: true/false and mode
```

---

## The cost model

All figures are basis points (bps) of notional and are subtracted from gross edge.

| Component | Source |
|---|---|
| Entry / exit fee | Config, defaulted per venue: Binance maker 2.0 / taker 5.0 bps, Bybit maker 2.0 / taker **5.5** bps |
| Entry / exit slippage | **Walks the live order book** for the actual order size; stops get a 1.6× adverse multiplier |
| Spread | Live bid/ask, crossed once on entry and once on exit |
| Adverse selection | Config (default 1.0 bps) for aggressive entry |
| Funding | **Real** funding rate × the symbol's **real** settlement interval over the expected hold, charged adversely plus a baseline (funding flips sign). Bybit varies the interval per symbol, so 8h is not assumed. |

`hurdle = max(total_cost × hurdle_multiplier, min_edge_bps)`

A trade is only placed when `expected_gross_edge_bps ≥ hurdle`. Costs are charged
on *notional turned over*, so leverage multiplies them rather than diluting them.

---

## Risk controls

All controls **fail closed** — missing data, a dead feed, or an unverifiable edge
resolves to "do not open new risk".

| Control | Default | Behaviour |
|---|---|---|
| Risk per trade | 0.5% of equity | Sized to the initial stop |
| Max leverage | 5× | Hard cap on implied leverage |
| Max position notional | 25% of equity | Per-position cap |
| Max gross exposure | 1.0× equity | Portfolio cap |
| Max concurrent positions | 3 | — |
| Daily loss limit | 3% | Halts for the rest of the UTC day (auto-clears next day) |
| Max drawdown | 12% | Kill switch — **requires manual reset** |
| Consecutive losses | 5 | Auto-halt |
| Max spread | 4 bps | Skips entries into wide books |
| Data staleness | 180 s | Blocks entries |
| Feed stale | 300 s | Forces REST refresh, blocks entries |
| Per-symbol gate | OOS evidence | Symbols with negative OOS expectancy are disabled |
| Auto-rollback | 6% drawdown | Reverts parameters to the last known-good version |

Open positions remain protected by their stops even while trading is halted.

---

## Learning and self-improvement

`app/learning.py` runs walk-forward optimisation over real history:

1. Rolling folds; each parameter set is evaluated on **test windows only**.
2. Score = risk-adjusted per-trade expectancy (bps), sample-shrunk toward zero and
   weighted by fold-to-fold consistency.
3. Aggregated by **median across symbols** — an edge that works on one symbol is a
   coincidence, not an edge.
4. Promotion requires beating the incumbent by `promotion_margin` *and* positive
   median OOS expectancy *and* no symbol with materially negative expectancy.
5. Every decision (promotion **or** rejection) is versioned in SQLite with full
   provenance; `rollback(version)` is one auditable call.

Per-symbol gating uses the same evidence to disable symbols whose edge is not real.
As of the last run this automatically disabled **QNTUSDT (−93.7 bps OOS over 25
trades)** and **ZECUSDT (−40.8 bps OOS over 22 trades)** while keeping 8 symbols.

A self-improvement loop that always "improves" is just a fancier way to overfit.
This one spends most of its time saying *no*.

---

## Dashboard

Served at `/`, token-gated. Everything is rendered from live production state:

- **Header** — mode (LIVE/PAPER), trading status, feed health, websocket state,
  equity, net PnL, unrealized, open positions, drawdown, fees.
- **Candlestick chart** — real OHLCV with a live-updating forming bar, volume, and
  the open position's entry/stop/target overlaid. Custom canvas renderer: no CDN,
  no third-party script, no external failure mode. Click any scanner row to chart it.
- **Banners** — halts, live-mode warning, feed problems, reconciliation issues, errors.
- **Positions** — entry, mark, stop (with BE/TR badges), target, notional, R now,
  unrealized net, fees, funding, entry cost bps, entry edge bps.
- **Scanner & decisions** — per symbol: real price, 24h, spread, funding, regime,
  estimated edge, the hurdle it must clear, sample count, action, and the full
  reason. Symbols gated off are marked `GATED`/`DISABLED`.
- **Equity curve**, **cost breakdown**, **orders**, **closed trades**
  (gross → fees → funding → net → R), **system health**, **params & learning
  history** with rollback buttons, and a **live log stream**.

Controls: Halt, Resume, Flatten all, Run optimisation, per-version rollback.

---

## API

Auth: `Authorization: Bearer <token>` or `?token=<token>`.
`/api/health`, `/api/ready`, `/api/stats` are unauthenticated and expose only
liveness counters.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` `/api/ready` `/api/stats` | Liveness, readiness, Prometheus metrics |
| GET | `/api/state` | Full snapshot (drives the dashboard) |
| GET | `/api/symbols` | Scanner rows with decisions |
| GET | `/api/candles?symbol=&limit=` | Real OHLCV |
| GET | `/api/positions` `/api/orders` `/api/trades` `/api/equity` | Book and history |
| GET | `/api/logs?limit=&level=` | Recent structured logs |
| GET | `/api/params` | Active params + learning history |
| POST | `/api/control/halt` `/resume` `/flatten` `/close` | Trading controls |
| POST | `/api/learning/run` `/rollback` `/toggle` | Learning controls |
| WS | `/ws?token=` | Live snapshot stream (2 s) |

There is deliberately **no** endpoint to send an arbitrary order or set leverage —
that would hand an attacker the account for the price of one token.

---

## Operations

| Task | Command |
|---|---|
| Run | `bash ops/run.sh` |
| Supervise (auto-restart, capped backoff) | `bash ops/watchdog.sh` |
| Health probe | `bash ops/healthcheck.sh` |
| Backup (online, safe while trading) | `bash ops/backup.sh` |
| End-to-end verification | `python3 ops/e2e_check.py` |
| Tests | `python3 -m pytest tests/ -q` |
| systemd (hardened unit) | `ops/systemd/quant.service` |

### Observability
- Structured JSON logs to stdout and `data/logs/quant.log` (rotated, 20 MB × 7).
- `/api/stats` in Prometheus exposition format.
- `/api/health` + `/api/ready` for orchestrators (`ready` returns 503 until the
  feed is connected and the first tick has run).
- In-memory log ring buffer streamed to the dashboard.
- Loop-latency gauges: `quant_tick_duration_seconds`, `quant_tick_duration_max_seconds`
  and `quant_slow_ticks_total`, mirrored in `/api/state` under `engine`. A tick that
  overruns the loop's cadence budget is counted, so the engine falling behind its own
  schedule surfaces instead of silently delaying entry scans.

### Self-healing
- Websocket reconnects with capped exponential backoff; an independent REST poller
  keeps candles fresh regardless.
- Stale or disconnected feed → trading blocked (not silently degraded).
- Live-mode reconciliation against exchange positions; divergences are logged,
  quantities repaired, untracked positions and missing positions flagged.
- Auto-rollback of parameters on live drawdown breach.
- Crash-safe: state in SQLite; restart reloads the equity curve and re-screens.
- Crash loop guarded by the watchdog; systemd unit has `Restart=always`.

### Security
- Bearer token on all data/control endpoints; constant-time comparison.
- Token generated on first boot, written `0600`, git-ignored.
- Per-IP token-bucket rate limiting.
- Credentials env-only, never logged (redaction patterns for keys/signatures).
- Pydantic validation on every request body.
- systemd hardening: unprivileged user, `ProtectSystem=strict`, `ProtectHome`,
  `NoNewPrivileges`, empty capability set, syscall filtering.
- `/api/stats` and `/api/health` leak nothing sensitive.

---

## Testing

230 unit tests (offline, deterministic) covering:

- **Look-ahead bias** — indicators and signals are asserted unchanged when future
  bars are appended; the simulator is asserted not to alter completed trades when
  the series is truncated.
- **Cost model** — book-walking slippage monotonic in size, adverse on both sides,
  funding sign correct, hurdle = multiple of cost, floor enforced.
- **Risk** — sizing risks exactly the configured fraction, every cap binds, and
  each circuit breaker trips; stale data and dead feed fail closed.
- **Ledger** — `net = gross − fees − funding` and
  `equity = starting + realized + unrealized` asserted exactly; SQLite round-trip.
- **Paper broker** — a flat round trip is a **loss** equal to costs; a stop exit is
  worse than a passive exit; funding charged correctly both directions.
- **Learning** — refuses promotion without OOS edge; grid bounds; rollback;
  gating fails closed; param application never mutates risk limits.
- **API** — 401/403/200 auth paths, input bounds, all UI-required snapshot fields,
  control flows.

Plus `ops/e2e_check.py`: 30 checks against live exchange data exercising the full
lifecycle (open → manage → stop → close → accounting → risk feedback → persistence).

---

## Known limitations

Stated plainly, because unstated limitations are how systems fail surprise their
operators.

1. **Paper fills, not real fills.** Live slippage on thin books or in fast markets
   will differ from the model. The paper broker is pessimistic by design, but it is
   still a model.
2. **Two venues, no cross-venue routing.** Bybit and Binance are supported
   individually; there is no smart order routing or cross-venue arbitrage.
   The **Bybit private (signed) path is verified up to the auth boundary** — Bybit
   accepts the signature and rejects only on IP allowlist — but has not been
   exercised against a funded account. The market-data path is verified live
   (43/43 checks, including 100/100 candles matched against raw Bybit REST).
3. **Signals are evaluated on closed 1h bars.** The engine will typically act at
   most once per hour per symbol. This is intentional (it removes intrabar
   hindsight) but it means the platform is not a scalper and should not be used as
   one.
4. **Funding is charged adversely plus a baseline**, so a strategy that only
   works when funding happens to favour it will be rejected. That is deliberate.
5. **The optimiser needs history to be meaningful.** With 10 000 hourly bars it
   evaluates ~200 out-of-sample trades across 6 symbols; on much shorter histories
   it will (correctly) decline to promote anything.
6. **No partial fills or order-book queue simulation.** Orders are modelled as
   fully filled.
7. **`app/portfolio.py`'s live funding attribution is approximate** — it reconciles
   the total from the exchange income endpoint but attributes per-position funding
   at an aggregate level.
8. **No multi-account or multi-user support.** One process, one account, one token.

---

## Configuration reference

`config/config.yaml` holds all non-secret settings. Select the venue with
`exchange.name` (`bybit` or `binance`); URLs and fee presets follow from it.

Any value can be overridden by environment variable:

```bash
QUANT__RISK__MAX_LEVERAGE=3
QUANT__DATA__PRIMARY_INTERVAL=4h
QUANT__LEARNING__ENABLED=false
```

Secrets are **never** read from YAML. The env prefix is
`QUANT__EXCHANGE__API_KEY` / `QUANT__EXCHANGE__API_SECRET` (note the double
underscore after `QUANT`, not a single one) — these are the only sources.
