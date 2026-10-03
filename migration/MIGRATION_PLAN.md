# Node → Python Migration: Inventory, Parity Map, and Staged Plan

**Status: INVENTORY AND PLANNING COMPLETE. NOTHING HAS BEEN MIGRATED OR DELETED.**

This document is the output of the mandated first step ("first inventory and map every existing
Node/Python feature"). It is deliberately blunt about scope, because the honest number changes the
plan: this is a ~38,000-line rewrite of a live trading platform, not a refactor.

Everything below is measured from the repository, not estimated from memory. Regenerate with:

```
python3 migration/extract_node_surface.py   # facts  -> migration/node_surface.json
python3 tests/test_parity.py                # gate   -> enforces the map
```

---

## 1. Measured current state

| Surface | Size | Notes |
|---|---|---|
| `gigpilot.py` (Python) | **1,636 lines** | single monolith; 8 FastAPI routes |
| Node backend (`server.ts` + `server/**`) | **16,614 lines** | 31 trading modules + 6 other modules |
| React frontend (`src/**`) | **14,115 lines** | 30 components |
| Scripts (tests + deploy) | **7,527 lines** | 38 files, 15 Node test suites |
| **Node/TS total** | **~38,256 lines** | the migration surface |

| Interface | Count |
|---|---|
| Node HTTP endpoints | **96** (63 trading router + 4 app + 29 webhook/aliases) |
| Python HTTP endpoints | **8** |
| pm2 apps | 3 (2 Node: `gigpilot`, `worker`; 1 Python: `gigpilot-engine`) |
| Node production dependencies | 37 — **16 imported nowhere** |
| Python dependencies | 9 |

## 2. The finding that should drive the plan: there are TWO trading stacks

This is not a Node app with a Python helper. It is **two parallel implementations of the same
trading system**, running side by side:

| Capability | Node implementation | Python implementation |
|---|---|---|
| Market data | `dataEngine.ts` (7 Bybit WS feeds) | WS feeds in `gigpilot.py` |
| Order placement | `exchangeExecutionEngine.ts` + `bybitAdapter.ts` | order paths in `gigpilot.py` |
| Reconciliation | `reconcileOpenOrders` | `Reconciler` class |
| Accounting | `profitAccounting.ts` | accounting reconciler |
| Risk | `riskEngine.ts` + `killSwitch.ts` | risk/limits in engine |
| Readiness | `tradingReadiness.ts` | `trading_ready` in `/health` |
| API server | Express (`server.ts`) | FastAPI (`gigpilot.py`) |

Two independently-operating copies of a trading system is not a style problem; it has already
produced three concrete production defects, all fixed during this engagement:

1. **Duplicate background loops.** Both pm2 processes imported the store singleton, so both ran
   reconciliation, capital sync and the optimizer against the same live account with separate
   in-memory state (`1c6652b`).
2. **Disagreeing credential signals.** The Python engine reported `privateWs: true` and
   `healthy: true` while the Node execution engine's REST calls were refused with
   *"API key is invalid"*. Neither surface joined the two facts (`da42a40`).
3. **An inert process.** `worker` ran for 4 hours with 55 restarts doing nothing, because the work
   it claimed to do lives in the API process.

**So the migration's real justification is not "Python is better" — it is that consolidating two
stacks into one removes an entire class of defect.** That is a legitimate reason to do it.

## 3. Parity map (enforced, not aspirational)

`migration/parity_map.json` holds **173 decisions** covering every enumerated item:

- 96 HTTP endpoints
- 31 trading modules + 6 other modules
- 3 pm2 processes
- 37 Node dependencies

`tests/test_parity.py` enforces four rules and is verified non-vacuous (each of these was
demonstrated to fail correctly):

1. **Completeness** — a newly added Node endpoint with no decision fails the gate.
2. **Honesty** — an entry marked `migrated` must point at a Python route/module that *actually
   exists*; a claim against a non-existent route fails.
3. **Deletion safety** — an entry may only be marked `removed` if `replacement_proven` is true
   **and** its Python target verifies. This implements "do not delete anything until its
   replacement is proven".
4. **Waiver discipline** — anything deliberately not migrated must carry a reason.

Current truthful state: **173 planned, 0 migrated.**

## 4. Target Python architecture

The 1,636-line monolith is not the target: it must be split so the parity gate can point at real
modules.

```
gigpilot/
  core/            config, clock, logging, errors, ids, kill-switch, background-ownership
  exchange/        bybit_rest.py, bybit_ws.py, instrument_specs, retry/idempotency, paper_mode
  market/          feeds, orderbook, candles, liquidity/universe selection
  strategy/        regime, signals, edge scoring, entry/exit, sizing, leverage, tp/sl
  risk/            limits, reserve, exposure, circuit breakers, fail-closed gates
  execution/       order router, idempotency keys, unknown-order resolution, reconciliation
  accounting/      fills, fees, funding, realized/net PnL, sweep, capital plan
  optimize/        evaluation, champion/challenger, rollout + rollback
  persistence/     state store (replaces Prisma), migrations, audit log
  api/             FastAPI app: owners auth, existing routes + migrated routes
  workers/         entrypoints that OWN background loops (single-owner invariant preserved)
  web/             dashboard delivery (see decision D1)
tests/             parity + runtime + contract tests
```

Security invariants that must be preserved **verbatim** in the port, with the same tests:
owner authentication/authorization, kill switch, fail-closed defaults, risk/capital limits,
credential validation (authenticate ≠ authorize), signed webhooks, execution idempotency,
reconciliation, persistence, PnL accounting, audit logging, single-owner background loops.

## 5. Staged plan (each stage ends with a gate)

| Stage | Work | Gate to pass before proceeding |
|---|---|---|
| **S0** | Inventory + parity map *(done)* | `tests/test_parity.py` green, non-vacuous |
| **S1** | Python skeleton: `core/`, `exchange/` (REST+WS), persistence, config; port the existing 8 routes into `api/` | runtime tests for idempotency + credential validation pass |
| **S2** | Port risk + execution + reconciliation + accounting, with their invariants | parity: those modules flip to `migrated` and verify; kill-switch/fail-closed tests green |
| **S3** | Port the 96 endpoints capability-by-capability | every endpoint `migrated` AND live-verified against the Python server |
| **S4** | Dashboard (decision D1) | dashboard reads only Python APIs, contract tests green |
| **S5** | Workers: single Python worker owning loops; retire the second pm2 app | ownership + restart + recovery tests green |
| **S6** | **Deletion** — only now | every entry `migrated` or `waived`; `replacement_proven` set; gate green |
| **S7** | Deploy hardening: remove npm from `deploy-ec2.sh`, dependency cleanup, hard-restart test | production verified, restart recovery verified |

Dependency cleanup (16 deps imported nowhere) belongs to S7, after the code that might still need
them is gone.

## 6. Decisions required

**D1 — Dashboard (blocks S4).** The SPA is 14,115 lines of React; a browser UI cannot be written
in Python. Two viable readings of "operationally Python-only":

- **(a) Prebuilt static bundle served by FastAPI.** No Node process at runtime; the React build
  still needs a Node toolchain at *build* time. Lowest risk, fastest, preserves the current UI.
- **(b) Rebuild the UI as Python-rendered templates (Jinja2 is already a dependency).** Truly no
  Node anywhere, but this throws away 14 k lines of working UI and is the single largest block of
  work in the entire migration.

I recommend **(a)**, with (b) as a later option if a Node toolchain is unacceptable. This must be
your call — it changes the plan's size by an order of magnitude.

**D2 — Uncommitted work in the tree.** `gigpilot.py`, `server/trading/{autonomousEngineProbe,
store,tradingReadiness}.ts` and two test scripts have **uncommitted, unverified modifications**
(the trade-authorization refinement: authenticating ≠ authorized to trade). It was interrupted
mid-verification, so it has not been linted, tested or deployed. It needs to be either finished and
verified, or reverted. I have deliberately not touched it. Production is unaffected (only committed
work deploys).

**D3 — Persistence.** `prisma/schema.prisma` + migrations exist and Prisma is imported in one
server file; `bull` (Redis queue) is imported in two. The Python target needs an explicit choice
(SQLAlchemy/asyncpg vs. file-backed state) and a decision on whether Redis is real infrastructure
here or a vestige — no Redis dependency appears in `requirements.txt`.

## 7. Honest scope statement

**I cannot truthfully claim this migration is complete, and I have not claimed it.** The measured
surface is ~38 k lines of Node/TS across 96 endpoints, 37 modules, 30 UI components and 15 test
suites. Rebuilding that in Python with parity tests, then verifying it, is a multi-month program
for a team — not a single session, and not something to rush on a system attached to a live
exchange account.

Claiming otherwise would be the exact failure mode you told me to avoid. What is genuinely done and
verifiable today:

- ✅ The surface is **enumerated** (173 items), not remembered.
- ✅ A **parity gate** exists, is wired, and is proven non-vacuous in all three failure modes.
- ✅ The **deletion rule is mechanised** — the gate physically refuses to allow `removed` without a
  verified replacement, so an accidental premature deletion cannot pass CI.
- ✅ The **duplication finding** is documented with the three production defects it already caused.
- ✅ A **target architecture and staged plan** with per-stage gates.
- ❌ No Python replacement code written yet. **Nothing deleted.** Production unchanged.

## 8. Recommended next step

Start **S1**: build the `core/` + `exchange/` Python foundation and port the existing 8 routes into
an `api/` package without changing behaviour, with runtime tests for execution idempotency and
credential validation ported first (they are the highest-value invariants). That is a bounded,
verifiable slice that does not touch production and does not require D1 to be resolved.

Then answer **D1** (dashboard) and **D2** (uncommitted work), since both block later stages.
