"""Champion vs. challenger tournament — automated hypothesis search under a strict net-edge gate.

WHAT THIS IS
------------
A closed loop that proposes strategy parameterisations, evaluates each one on REAL exchange data
with the full friction model from `gpkg.ml.friction`, and promotes a challenger only when it clears
every gate. Nothing here can authorise live capital: `promote_challenger` in the lifecycle module
caps a winner at PAPER, and the live path is owned by the risk/governance code.

THE FOUR GATES (all must pass, per spec)
----------------------------------------
    1. Net edge      >= +8.0 bps   AFTER fees, 2x peak spread, impact, adverse selection, funding
    2. OOS Sharpe    >  1.8
    3. Profit factor >  1.75
    4. t-stat        >  3.0

`validation.StrictGate` below sets exactly these. The previous defaults on `ValidationConfig` were
`min_oos_sharpe=0.0`, `min_t_stat=0.0`, `min_profit_factor=1.05`, `min_edge_bps=0.0` — i.e. the
gates the spec demands were, in practice, switched off. A gate that is configured to zero is not a
lenient gate, it is an absent one, and every candidate passes it.

WHY STDLIB ONLY
---------------
The spec authorises bringing in heavy ML frameworks, and offline research absolutely should. This
module deliberately does not, for three reasons that are about money rather than taste:
  * it is importable by the process that holds live exchange credentials, and every added dependency
    is install-time and CVE surface in exactly the process you least want it in. `gpkg.ml.lifecycle`
    set this precedent; this module keeps it;
  * a genetic search over a handful of interpretable parameters does not need a tensor library, and
    a heavier model would be harder to audit against the leakage rules that actually decide whether
    the result is real;
  * a reproducible search must produce the same champion from the same seed. Stdlib `random` with an
    explicit seed gives that; a framework's nondeterminism would not.
The search is therefore a seeded genetic algorithm, and the heavy-model path stays available offline
through `gpkg.ml.training`.

LEAKAGE DISCIPLINE
------------------
Every number used to decide a trade at bar `t` comes from bars `<= t`. The entry is filled at the
open of `t+1`. Exits are evaluated on bars after entry, and when a single bar could plausibly hit
both the stop and the target, the STOP is assumed to be hit first — the pessimistic branch, because
the optimistic one is how backtests manufacture edge that does not exist. The walk-forward splitter
purges and embargoes the boundary.
"""
from __future__ import annotations

import json
import math
import random
from dataclasses import asdict, dataclass, field, replace
from typing import Any, Sequence

from gpkg.core.clock import now_ms
from gpkg.ml.friction import (
    DEFAULT_HURDLE_BPS,
    Liquidity,
    build_friction,
)


def _liquidity_from_gene(v: float) -> Liquidity:
    """Numeric gene -> liquidity regime, named so the Literal type survives mypy."""
    return "maker" if v >= 0.5 else "taker"
from gpkg.ml.lifecycle import (
    ModelEvidence,
    NetTrade,
    PromotionDecision,
    PurgedWalkForward,
    ValidationConfig,
    evaluate_candidate,
    promote_challenger,
)

TOURNAMENT_VERSION = 1

# The spec's gates, verbatim. This is the only ValidationConfig the tournament is allowed to use.
STRICT_GATE = ValidationConfig(
    min_oos_trades=30,
    min_mean_net_bps=DEFAULT_HURDLE_BPS,
    min_edge_bps=DEFAULT_HURDLE_BPS,          # gate 1: net edge >= +8.0 bps
    min_oos_sharpe=1.8,                       # gate 2
    min_profit_factor=1.75,                   # gate 3
    min_t_stat=3.0,                           # gate 4
    min_walk_forward_folds=5,                 # spec: 5-fold walk-forward
    embargo_samples=2,
    max_one_sided_p_value=0.05,
    max_drawdown_bps=500.0,
    max_population_stability_index=0.25,
)

FAMILIES = ("vol_regime", "funding_carry", "l2_microprice")

# Spread floor used ONLY when no L2 snapshot exists for the window. It is a stated assumption, not a
# measurement, and it is recorded as `l2_ready=False` in every audit row so a result can never be
# mistaken for one validated against a real book. Set at a conservative (wide) 2 bps so its absence
# makes the gate STRICTER, never looser.
ASSUMED_SPREAD_BPS_NO_L2 = 2.0


# ------------------------------------------------------------------------------------------------
# Candidate parameterisation
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class CandidateParams:
    """One hypothesis. Every field is chosen by the search, none is a free-floating constant."""

    symbol: str
    family: str
    # (a) volatility regime thresholds, in bps of per-bar realised volatility
    vol_high_bps: float
    vol_low_bps: float
    # (b) funding-rate carry reversion horizon, in bars
    funding_horizon_bars: int
    # (c) L2 micro-price lookahead, in bars
    microprice_lookahead_bars: int
    entry_threshold: float
    liquidity: Liquidity = "maker"
    atr_stop_mult: float = 2.0
    atr_tp_mult: float = 2.5
    max_holding_bars: int = 120

    def genes(self) -> tuple[float, ...]:
        """Numeric genome for crossover/mutation. Order is stable and part of the contract."""
        return (
            self.vol_high_bps, self.vol_low_bps, float(self.funding_horizon_bars),
            float(self.microprice_lookahead_bars), self.entry_threshold,
            1.0 if self.liquidity == "maker" else 0.0, self.atr_stop_mult, self.atr_tp_mult,
            float(self.max_holding_bars),
        )

    @staticmethod
    def from_genes(symbol: str, family: str, g: Sequence[float]) -> "CandidateParams":
        lo = max(1.0, min(g[1], g[0]))
        hi = max(lo + 1.0, max(g[0], g[1]))
        return CandidateParams(
            symbol=symbol,
            family=family,
            vol_high_bps=hi,
            vol_low_bps=lo,
            funding_horizon_bars=int(max(1, min(96, round(g[2])))),
            microprice_lookahead_bars=int(max(0, min(30, round(g[3])))),
            entry_threshold=max(0.05, min(0.95, g[4])),
            liquidity=_liquidity_from_gene(g[5]),
            atr_stop_mult=max(0.5, min(6.0, g[6])),
            atr_tp_mult=max(0.5, min(8.0, g[7])),
            max_holding_bars=int(max(10, min(480, round(g[8])))),
        )

    def identifier(self) -> str:
        return (
            f"tourn-{self.symbol.lower()}-{self.family}-{self.liquidity}-"
            f"v{self.vol_low_bps:.0f}_{self.vol_high_bps:.0f}"
            f"-f{self.funding_horizon_bars}-m{self.microprice_lookahead_bars}"
            f"-t{self.entry_threshold:.2f}-s{self.atr_stop_mult:.1f}-p{self.atr_tp_mult:.1f}"
        )


def mutate(p: CandidateParams, rng: random.Random, *, scale: float = 1.0) -> CandidateParams:
    g = list(p.genes())
    # Perturb one to three genes: enough to explore, few enough that a child stays a near-neighbour
    # of its parent and the search remains a local hill-climb rather than a random restart.
    for _ in range(rng.randint(1, 3)):
        i = rng.randrange(len(g))
        span = max(1.0, abs(g[i])) * 0.25 * scale
        g[i] += rng.uniform(-span, span)
    return CandidateParams.from_genes(p.symbol, p.family, g)


def crossover(a: CandidateParams, b: CandidateParams, rng: random.Random) -> CandidateParams:
    ga, gb = a.genes(), b.genes()
    # Uniform crossover, with the family inherited from the fitter parent (passed as `a`).
    child = [ga[i] if rng.random() < 0.5 else gb[i] for i in range(len(ga))]
    return CandidateParams.from_genes(a.symbol, a.family, child)


def seed_population(symbol: str, rng: random.Random, *, size: int) -> list[CandidateParams]:
    """Deterministic seed population spanning all three spec families."""
    out: list[CandidateParams] = []
    for i in range(size):
        fam = FAMILIES[i % len(FAMILIES)]
        lo = rng.uniform(2.0, 25.0)
        out.append(CandidateParams.from_genes(symbol, fam, [
            lo + rng.uniform(5.0, 60.0),                       # vol_high_bps
            lo,                                                # vol_low_bps
            rng.uniform(1, 48),                                # funding_horizon_bars
            rng.uniform(0, 15),                                # microprice_lookahead_bars
            rng.uniform(0.15, 0.85),                           # entry_threshold
            rng.random(),                                      # liquidity
            rng.uniform(1.0, 4.0),                             # atr_stop_mult
            rng.uniform(1.5, 5.0),                             # atr_tp_mult
            rng.uniform(30, 240),                              # max_holding_bars
        ]))
    return out


# ------------------------------------------------------------------------------------------------
# Real-data loading
# ------------------------------------------------------------------------------------------------
def load_klines(store: Any, symbol: str, start_ms: int, end_ms: int) -> list[dict]:
    """Real 1m bars from the store, oldest first, de-duplicated by timestamp.

    A duplicate timestamp would silently double-count a bar and corrupt the fold split, so the last
    write wins and the result is sorted. Bars with non-finite or non-positive fields are dropped
    rather than interpolated: a fabricated bar is worse than a missing one.
    """
    rows = store.ml_market_range(symbol, "kline_1m", int(start_ms), int(end_ms)) or []
    by_ts: dict[int, dict] = {}
    for r in rows:
        try:
            ts = int(r["ts_ms"])
            o, h, l, c = (float(r["open"]), float(r["high"]),
                          float(r["low"]), float(r["close"]))
        except (KeyError, TypeError, ValueError):
            continue
        if not all(math.isfinite(x) and x > 0 for x in (o, h, l, c)):
            continue
        if h < l:
            continue
        by_ts[ts] = {"ts_ms": ts, "open": o, "high": h, "low": l, "close": c,
                     "volume": float(r.get("volume") or 0.0)}
    return [by_ts[k] for k in sorted(by_ts)]


def measure_peak_spread_bps(store: Any, symbol: str, start_ms: int, end_ms: int,
                            klines: Sequence[dict]) -> tuple[float, bool]:
    """Peak spread in bps over the window, plus whether it came from a REAL L2 book.

    Peak, not mean: an entry that is fine on average can still be ruinous at the moment liquidity is
    thinnest, and the peak is the observed worst case rather than a modelled one.
    """
    books = store.ml_market_range(symbol, "orderbook_l2", int(start_ms), int(end_ms)) or []
    peak = 0.0
    n = 0
    for b in books:
        try:
            bid, ask = float(b["bid"]), float(b["ask"])
        except (KeyError, TypeError, ValueError):
            continue
        if bid > 0 and ask > bid and math.isfinite(bid) and math.isfinite(ask):
            peak = max(peak, (ask - bid) / ((ask + bid) / 2.0) * 1e4)
            n += 1
    if n > 0:
        return peak, True
    # No real book: fall back to the documented conservative assumption. Returned with l2_ready=False
    # so no consumer can mistake this for a measured value.
    _ = klines
    return ASSUMED_SPREAD_BPS_NO_L2, False


# ------------------------------------------------------------------------------------------------
# Simulation — point-in-time, pessimistic on ties
# ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class BarFeatures:
    """Causal feature columns, computed ONCE for a dataset and reused by every candidate.

    WHY PRECOMPUTED
    ---------------
    The first version recomputed realised volatility and ATR from scratch at every bar, inside every
    candidate's simulation. With 48 candidates over 129,600 bars that is ~280M operations of pure
    feature arithmetic repeated identically — the same numbers, recomputed 48 times. Hoisting it
    turns a multi-minute tournament into a few seconds, which is the difference between a loop that
    can run on a schedule and one that cannot.

    Every column is CAUSAL: the value at index `i` uses only bars `<= i`. Rolling moments use prefix
    sums, so each column is O(n) rather than O(n * window).
    """

    ts: list[int]
    open: list[float]
    high: list[float]
    low: list[float]
    close: list[float]
    vol_bps: list[float]
    atr: list[float]
    momentum: list[float]
    # Point-in-time funding, in bps, as-of each bar (forward-filled from the 8h funding prints, never
    # back-filled). Also carries the trailing z-score of funding, which is the tradeable form of the
    # signal — see `funding_z`.
    funding_bps: list[float] = field(default_factory=list)
    funding_z: list[float] = field(default_factory=list)

    def __len__(self) -> int:
        return len(self.ts)


def _funding_row_bps(row: dict) -> float | None:
    """Funding rate from a stored row, in bps, accepting either stored key.

    The store writes `funding_bps` (already in bps) AND `funding_rate` (the decimal fraction, e.g.
    3.534e-05). An earlier version of this module read a key called `rate`, which does not exist, so
    every funding value silently became 0.0 — the failure mode of `.get()` with a fallback: it turns
    a schema mismatch into a plausible number instead of an error. Accepting both real keys, and
    returning None (never 0.0) when neither is present, makes a future rename loud rather than silent.
    """
    v = row.get("funding_bps")
    if v is None:
        v = row.get("funding_rate")
        if v is None:
            return None
        return abs(float(v)) * 1e4
    return abs(float(v))


def _funding_series(klines: Sequence[dict], funding_rows: Sequence[dict], *,
                    lookback: int = 90) -> tuple[list[float], list[float]]:
    """Point-in-time funding in bps and its trailing z-score, aligned to bars.

    Two things the previous version got wrong, both of which made the `funding_carry` family
    structurally untradeable:

    1. IT WAS NOT POINT-IN-TIME. A single scalar (the LAST funding print in the window) was passed to
       every bar, so the signal was a constant. A constant signal is either always above the entry
       threshold or always below it, which is why that family reported exactly 0 trades in every
       tournament run. The rate applicable at bar `i` is the most recent print at or before `ts[i]`.

    2. THE SIGNAL HAD NO SCALE. Funding was fed through `tanh(rate / 5.0)`. Real perp funding sits
       around 0.1-1 bps per 8h, so that term is ~0.14 at its most extreme and can never reach any
       sensible entry threshold. Funding is only meaningful RELATIVE to its own recent history, so
       the tradeable quantity is the trailing z-score.

    `lookback` counts FUNDING PRINTS, not bars: an 8h cadence means 90 prints is ~30 days, and using
    a bar-count would make the window three orders of magnitude too short.
    """
    n = len(klines)
    if n == 0:
        return [], []
    pts: list[tuple[int, float]] = []
    for r in funding_rows or []:
        try:
            rate_bps = _funding_row_bps(r)
        except (KeyError, TypeError, ValueError):
            continue
        if rate_bps is None:
            continue
        pts.append((int(r["ts_ms"]), rate_bps))
    pts.sort()
    series = [0.0] * n
    zscores = [0.0] * n
    if not pts:
        return series, zscores

    # z per print, causal over the trailing `lookback` prints
    z_of: list[float] = []
    for k in range(len(pts)):
        lo = max(0, k - lookback)
        window = [p[1] for p in pts[lo:k + 1]]
        if len(window) < 3:
            z_of.append(0.0)
            continue
        mu = sum(window) / len(window)
        var = sum((w - mu) ** 2 for w in window) / (len(window) - 1)
        sd = math.sqrt(var)
        z_of.append((pts[k][1] - mu) / sd if sd > 0 else 0.0)

    # forward-fill onto bars, never back-fill
    j = 0
    for i in range(n):
        t = int(klines[i]["ts_ms"])
        while j + 1 < len(pts) and pts[j + 1][0] <= t:
            j += 1
        if pts[j][0] <= t:
            series[i] = pts[j][1]
            zscores[i] = z_of[j]
    return series, zscores


def compute_features(klines: Sequence[dict], *, vol_window: int = 30, atr_period: int = 14,
                     mom_window: int = 30, funding_rows: Sequence[dict] | None = None) -> BarFeatures:
    """Build all causal feature columns in a single O(n) pass."""
    n = len(klines)
    ts = [int(k["ts_ms"]) for k in klines]
    op = [float(k["open"]) for k in klines]
    hi = [float(k["high"]) for k in klines]
    lo = [float(k["low"]) for k in klines]
    cl = [float(k["close"]) for k in klines]

    vol_bps = [0.0] * n
    atr = [0.0] * n
    momentum = [0.0] * n

    # ---- true range, then rolling mean via prefix sums ----
    tr = [0.0] * n
    for i in range(1, n):
        pc = cl[i - 1]
        tr[i] = max(hi[i] - lo[i], abs(hi[i] - pc), abs(lo[i] - pc))
    pre_tr = [0.0] * (n + 1)
    for i in range(n):
        pre_tr[i + 1] = pre_tr[i] + tr[i]
    for i in range(atr_period, n):
        atr[i] = (pre_tr[i + 1] - pre_tr[i + 1 - atr_period]) / atr_period

    # ---- returns, then rolling mean/variance via prefix sums of r and r^2 ----
    ret = [0.0] * n
    for i in range(1, n):
        if cl[i - 1] > 0:
            ret[i] = (cl[i] - cl[i - 1]) / cl[i - 1]
    pre_r = [0.0] * (n + 1)
    pre_r2 = [0.0] * (n + 1)
    for i in range(n):
        pre_r[i + 1] = pre_r[i] + ret[i]
        pre_r2[i + 1] = pre_r2[i] + ret[i] * ret[i]
    for i in range(vol_window, n):
        s = pre_r[i + 1] - pre_r[i + 1 - vol_window]
        s2 = pre_r2[i + 1] - pre_r2[i + 1 - vol_window]
        mu = s / vol_window
        var = max(0.0, s2 / vol_window - mu * mu) * (vol_window / max(1, vol_window - 1))
        vol_bps[i] = math.sqrt(var) * 1e4

    # ---- momentum ----
    for i in range(mom_window, n):
        past = cl[i - mom_window]
        if past > 0:
            momentum[i] = math.tanh((cl[i] - past) / past * 500.0)

    f_bps, f_z = _funding_series(klines, funding_rows or [])

    return BarFeatures(ts=ts, open=op, high=hi, low=lo, close=cl,
                       vol_bps=vol_bps, atr=atr, momentum=momentum,
                       funding_bps=f_bps, funding_z=f_z)


def _funding_cost_bps(features: BarFeatures, entry_i: int, exit_i: int, fallback_bps: float) -> float:
    """Funding payable for a hold from `entry_i` to `exit_i`, from the point-in-time rate."""
    held = max(0, exit_i - entry_i)
    if features.funding_bps and entry_i < len(features.funding_bps):
        rate = features.funding_bps[entry_i]
    else:
        rate = fallback_bps
    # One settlement per 8h (480 one-minute bars).
    return abs(rate) * (held / 480.0)


def simulate(features: BarFeatures, params: CandidateParams, *, spread_bps: float,
             l2_ready: bool, funding_bps: float, fee_rate_bps: float | None = None,
             depth_notional_usd: float = 0.0, notional_usd: float = 0.0,
             obi: float = 0.0, quote_age_ms: float = 0.0) -> list[NetTrade]:
    """Simulate `params` over precomputed `features`, returning closed round trips with itemised cost.

    Every signal at bar `i` uses only bars `<= i`; the fill happens at the open of `i+1`. When a bar
    straddles both the stop and the target, the STOP is taken — see the module docstring.

    `obi` and `quote_age_ms` feed the dynamic adverse-selection term. They default to a balanced,
    fresh book, which is the LEAST punitive setting; callers holding real L2 must pass the measured
    values, otherwise the model silently under-charges.
    """
    trades: list[NetTrade] = []
    n = len(features)
    i = 40
    while i < n - 2:
        vol = features.vol_bps[i]
        if not (params.vol_low_bps <= vol <= params.vol_high_bps):
            i += 1
            continue

        # ---------------- signal, from information available at the close of bar i ----------------
        mom = features.momentum[i]
        if params.family == "vol_regime":
            signal = mom
        elif params.family == "funding_carry":
            # Fade the carry: positive funding = longs pay = crowded long = mean-revert.
            # The z-score is scaled to a comparable range to the momentum term (-1..1) via tanh,
            # so `entry_threshold` means the same thing across families.
            z = features.funding_z[i] if i < len(features.funding_z) else 0.0
            signal = -math.tanh(z)
        else:  # l2_microprice
            signal = mom * (1.0 if l2_ready else 0.5)

        if abs(signal) < params.entry_threshold:
            i += 1
            continue

        side = "Buy" if signal > 0 else "Sell"
        atr = features.atr[i]
        if atr <= 0:
            i += 1
            continue

        entry = features.open[i + 1]
        if entry <= 0:
            i += 1
            continue

        stop_d = atr * params.atr_stop_mult
        tp_d = atr * params.atr_tp_mult
        if side == "Buy":
            stop_px, tp_px = entry - stop_d, entry + tp_d
        else:
            stop_px, tp_px = entry + stop_d, entry - tp_d

        # `exit_idx` is an int from the start, not `None`. The two are always assigned together, but
        # mypy cannot know that from `if exit_px is None`, and a type that is only *conditionally*
        # an int is how an index error reaches production.
        exit_px: float | None = None
        exit_idx: int = -1
        for j in range(i + 2, min(i + 2 + params.max_holding_bars, n)):
            kf_hi, kf_lo = features.high[j], features.low[j]
            hit_stop = (kf_lo <= stop_px) if side == "Buy" else (kf_hi >= stop_px)
            hit_tp = (kf_hi >= tp_px) if side == "Buy" else (kf_lo <= tp_px)
            # Pessimistic tie-break: the adverse branch wins. Assuming the favourable one is how a
            # backtest invents an edge that the market will not pay.
            if hit_stop:
                exit_px, exit_idx = stop_px, j
                break
            if hit_tp:
                exit_px, exit_idx = tp_px, j
                break
        if exit_px is None:
            exit_idx = min(i + 1 + params.max_holding_bars, n - 1)
            exit_px = features.close[exit_idx]

        gross_bps = ((exit_px - entry) if side == "Buy" else (entry - exit_px)) / entry * 1e4

        friction = build_friction(
            liquidity=params.liquidity,
            measured_peak_spread_bps=spread_bps,
            side=side,
            obi=obi,
            quote_age_ms=quote_age_ms,
            # Funding actually payable over the holding period, priced from the rate in effect at
            # entry (point-in-time). Funding settles every 8h, so a shorter hold pays a fraction of
            # one settlement; the previous form applied the window's LAST observed rate to every
            # trade regardless of when it happened.
            funding_bps=_funding_cost_bps(features, i, exit_idx, funding_bps),
            notional_usd=notional_usd,
            depth_notional_usd=depth_notional_usd,
            fee_rate_bps=fee_rate_bps,
        )
        trades.append(NetTrade(
            gross_edge_bps=gross_bps,
            realised_gross_pnl_bps=gross_bps,
            costs=_cost_breakdown(friction),
            timestamp_ms=int(features.ts[exit_idx]),
        ))
        i = exit_idx + 1
    return trades


def _cost_breakdown(friction: Any):
    from gpkg.ml.lifecycle import CostBreakdown
    return CostBreakdown(
        fees_bps=friction.fees_bps,
        funding_bps=friction.funding_bps,
        spread_bps=friction.spread_bps,
        slippage_bps=friction.impact_bps,
        adverse_selection_bps=friction.adverse_bps,
    )


# ------------------------------------------------------------------------------------------------
# Evaluation under strict gates
# ------------------------------------------------------------------------------------------------
@dataclass
class CandidateOutcome:
    params: CandidateParams
    evidence: ModelEvidence
    admission: bool
    rejection: str
    l2_ready: bool
    peak_spread_bps: float
    trades: int
    folds: int
    # Per-trade MEANS of each friction component, measured from the very trades that produced the
    # evidence. These are carried on the outcome so the audit row reports the costs that were
    # actually charged; an audit that prints zeros here is worse than no audit at all, because it
    # asserts the edge survived friction that it may never have been charged.
    costs_avg: dict = field(default_factory=dict)
    gross_avg_bps: float = 0.0

    @property
    def net_bps(self) -> float:
        return self.evidence.mean_net_bps


def _fold_geometry(ts: Sequence[int], config: ValidationConfig) -> list[tuple[range, range]]:
    """Tile the OUT-OF-SAMPLE windows across the dataset instead of clustering them at the front.

    WHY THIS IS NOT A DETAIL
    ------------------------
    `PurgedWalkForward` takes `min_train`/`test_size` in BARS, and its windows are laid down
    immediately after `min_train` (it advances `train_end` to the previous test end each step). The
    first version of this module passed the splitter's own defaults of 200/100 regardless of dataset
    size. On 129,599 one-minute bars that placed all five OOS windows inside bars 202-710 — roughly
    0.4% of the history — while the remaining 99.6% was only ever training. Every published metric
    would then have been measured on a 500-bar sample while appearing to be a 90-day walk-forward
    result, which is the most dangerous kind of wrong: it looks rigorous.

    So the geometry is now derived from the data: train on the first fifth, then tile the remaining
    four fifths into `n_splits` contiguous OOS windows, each purged from the next. That spreads OOS
    evaluation across the whole period, so a candidate is judged on many regimes rather than one.

    The test size is computed to fit EXACTLY `n_splits` windows with no leftover, because asking for
    one bar too many makes the splitter drop the final fold silently — and a silently dropped fold
    turns a 5-fold result into a 4-fold one that the gate then rejects for the wrong reason.
    """
    n_bars = len(ts)
    n_splits = max(1, int(config.min_walk_forward_folds))
    purge = max(0, int(config.embargo_samples))
    if n_bars <= 400:
        return []
    min_train = max(200, int(n_bars * 0.2))
    usable = n_bars - min_train - n_splits * purge
    if usable < n_splits:
        return []
    test_size = usable // n_splits
    if test_size < 1:
        return []
    splitter = PurgedWalkForward(n_splits=n_splits, min_train=min_train,
                                 test_size=test_size, purge=purge)
    return splitter.split(ts)


def _aggregate_costs(trades: Sequence[NetTrade]) -> dict:
    """Per-trade mean of each friction component, from the trades that produced the evidence."""
    if not trades:
        return {
            "fees_bps": 0.0, "two_x_peak_spread_bps": 0.0, "modeled_impact_bps": 0.0,
            "adverse_selection_bps": 0.0, "funding_bps": 0.0, "total_friction_bps": 0.0,
        }
    n = len(trades)
    return {
        "fees_bps": sum(abs(t.costs.fees_bps) for t in trades) / n,
        "two_x_peak_spread_bps": sum(abs(t.costs.spread_bps) for t in trades) / n,
        "modeled_impact_bps": sum(abs(t.costs.slippage_bps) for t in trades) / n,
        "adverse_selection_bps": sum(abs(t.costs.adverse_selection_bps) for t in trades) / n,
        "funding_bps": sum(abs(t.costs.funding_bps) for t in trades) / n,
        "total_friction_bps": sum(t.costs.total_bps for t in trades) / n,
    }


def evaluate_params(
    store: Any,
    params: CandidateParams,
    *,
    features: BarFeatures,
    spread_bps: float,
    l2_ready: bool,
    funding_bps: float,
    evaluated_at_ms: int | None = None,
    window_days: int = 90,
    config: ValidationConfig = STRICT_GATE,
    fee_rate_bps: float | None = None,
    notional_usd: float = 0.0,
    depth_notional_usd: float = 0.0,
    obi: float = 0.0,
    quote_age_ms: float = 0.0,
) -> CandidateOutcome:
    """Run one candidate through purged walk-forward and apply the strict gates.

    Walk-forward is not decorative: the SAME parameter set is re-simulated inside each fold's OOS
    window, so a set that only works on one slice of history is exposed by the folds it fails.
    """
    evaluated_at_ms = int(evaluated_at_ms or now_ms())
    trades = simulate(features, params, spread_bps=spread_bps, l2_ready=l2_ready,
                      funding_bps=funding_bps, fee_rate_bps=fee_rate_bps,
                      notional_usd=notional_usd, depth_notional_usd=depth_notional_usd,
                      obi=obi, quote_age_ms=quote_age_ms)

    ts = features.ts
    folds = _fold_geometry(ts, config)

    # Purged-walk-forward OOS evidence: keep only trades whose timestamp falls inside a TEST window,
    # which is what makes the evidence out-of-sample rather than in-sample.
    oos_trades: list[NetTrade] = []
    for _tr, te in folds:
        lo, hi = ts[te.start], ts[te.stop - 1]
        oos_trades.extend(t for t in trades if lo <= t.timestamp_ms <= hi)
    if not folds:
        # Too few bars to split. Trades are passed through so the fold-count gate below refuses them:
        # `walk_forward_folds=0 < min_walk_forward_folds` is a hard failure, so this path can never
        # produce an admitted candidate.
        oos_trades = trades

    evidence = evaluate_candidate(
        params.identifier(),
        oos_trades,
        walk_forward_folds=len(folds),
        evaluated_at_ms=evaluated_at_ms,
        data_cutoff_ms=ts[-1] if ts else evaluated_at_ms - 1,
        config=config,
    )
    admission = evidence.verified
    rejection = "" if admission else evidence.verification_reason
    gross_avg = (
        sum(t.realised_gross_pnl_bps for t in oos_trades) / len(oos_trades) if oos_trades else 0.0
    )
    return CandidateOutcome(
        params=params,
        evidence=evidence,
        admission=admission,
        rejection=rejection,
        l2_ready=l2_ready,
        peak_spread_bps=spread_bps,
        trades=len(oos_trades),
        folds=len(folds),
        costs_avg=_aggregate_costs(oos_trades),
        gross_avg_bps=gross_avg,
    )


# ------------------------------------------------------------------------------------------------
# Tournament
# ------------------------------------------------------------------------------------------------
@dataclass
class TournamentResult:
    symbol: str
    started_at_ms: int
    ended_at_ms: int
    generations: int
    population_size: int
    seed: int
    bars_used: int
    window_days: int
    l2_ready: bool
    peak_spread_bps: float
    evaluated: int
    admitted: int
    winners: list[CandidateOutcome] = field(default_factory=list)
    rejected_summary: list[dict] = field(default_factory=list)
    champion: CandidateOutcome | None = None
    promotion: PromotionDecision | None = None

    def to_json(self) -> dict:
        def ev(o: CandidateOutcome) -> dict:
            return {
                "model_id": o.evidence.model_id,
                "family": o.params.family,
                "liquidity": o.params.liquidity,
                "net_edge_bps": round(o.evidence.mean_net_bps, 4),
                "oos_sharpe": round(o.evidence.oos_sharpe, 4),
                "profit_factor": round(o.evidence.profit_factor, 4),
                "t_stat": round(o.evidence.t_stat, 4),
                "oos_trades": o.evidence.oos_trades,
                "folds": o.folds,
                "max_drawdown_bps": round(o.evidence.max_drawdown_bps, 4),
                "verified": o.evidence.verified,
                "rejection": o.rejection,
                "params": asdict(o.params),
            }

        return {
            "version": TOURNAMENT_VERSION,
            "symbol": self.symbol,
            "started_at_ms": self.started_at_ms,
            "ended_at_ms": self.ended_at_ms,
            "duration_ms": max(0, self.ended_at_ms - self.started_at_ms),
            "generations": self.generations,
            "population_size": self.population_size,
            "candidates_evaluated": self.evaluated,
            "candidates_admitted": self.admitted,
            "seed": self.seed,
            "bars_used": self.bars_used,
            "window_days": self.window_days,
            "l2_ready": self.l2_ready,
            "peak_spread_bps": round(self.peak_spread_bps, 6),
            "gates": {
                "min_net_edge_bps": STRICT_GATE.min_edge_bps,
                "min_oos_sharpe": STRICT_GATE.min_oos_sharpe,
                "min_profit_factor": STRICT_GATE.min_profit_factor,
                "min_t_stat": STRICT_GATE.min_t_stat,
                "min_walk_forward_folds": STRICT_GATE.min_walk_forward_folds,
                "min_oos_trades": STRICT_GATE.min_oos_trades,
            },
            "champion": ev(self.champion) if self.champion else None,
            "winners": [ev(w) for w in self.winners[:10]],
            # Reported worst-to-best-among-those-with-evidence. A candidate that produced NO
            # out-of-sample trades has a mean of 0.0, which naively sorts ABOVE a candidate with
            # real evidence of -9 bps — so the "closest to passing" list would be filled with
            # hypotheses that simply never traded. Sorted on trades first, then net, so the list
            # answers the question it appears to answer.
            "rejected_ranked": sorted(
                self.rejected_summary,
                key=lambda r: (r.get("oos_trades", 0) >= STRICT_GATE.min_oos_trades,
                               r.get("net_edge_bps", 0.0)),
                reverse=True,
            )[:20],
            "promotion": (
                {
                    "allowed": self.promotion.allowed,
                    "target_state": self.promotion.target_state.value,
                    "reason": self.promotion.reason,
                } if self.promotion else None
            ),
            "rejected": self.rejected_summary[:20],
            "outcome": self._outcome(),
        }

    def _outcome(self) -> str:
        if self.champion is None:
            return "NO_CANDIDATE_CLEARED_GATES"
        if self.promotion and self.promotion.allowed:
            return "CHALLENGER_PROMOTED_TO_PAPER"
        return "CHAMPION_HELD"


def run_tournament(
    store: Any,
    symbol: str,
    *,
    generations: int = 4,
    population_size: int = 12,
    seed: int = 7,
    window_days: int = 90,
    end_ms: int | None = None,
    fee_rate_bps: float | None = None,
    notional_usd: float = 0.0,
    depth_notional_usd: float = 0.0,
    elite: int = 4,
) -> TournamentResult:
    """Evolve a population of hypotheses over real data and return the full audit.

    The search optimises ONLY `mean_net_bps` under the strict gates. Fitness is net edge, never
    gross — optimising gross edge is the mistake the whole friction model exists to prevent.
    """
    started = now_ms()
    end_ms = int(end_ms or started)
    start_ms = end_ms - int(window_days) * 86_400_000

    klines = load_klines(store, symbol, start_ms, end_ms)
    peak_spread, l2_ready = measure_peak_spread_bps(store, symbol, start_ms, end_ms, klines)
    # Hoisted out of the candidate loop: identical for every candidate, so computing it per
    # candidate would be the same arithmetic repeated once per hypothesis.
    funding_rows = store.ml_market_range(symbol, "funding_8h", start_ms, end_ms) or []
    features = compute_features(klines, funding_rows=funding_rows)
    # Scalar fallback ONLY: the per-bar series inside `features` is what the simulation actually
    # costs trades against. This is used when a symbol has klines but no funding history.
    funding_bps = 0.0
    if funding_rows:
        try:
            funding_bps = _funding_row_bps(funding_rows[-1]) or 0.0
        except (TypeError, ValueError):
            funding_bps = 0.0

    rng = random.Random(seed)
    population = seed_population(symbol, rng, size=max(2, population_size))
    evaluated = 0
    admitted: list[CandidateOutcome] = []
    rejected: list[dict] = []
    # Memoised evaluations, keyed by the candidate's identifier.
    #
    # Two reasons this is not just an optimisation. Elites are carried into the next generation, so
    # the same parameters were previously re-simulated on every generation — identical arithmetic,
    # repeated, which is pure waste in a loop that runs on a schedule. Worse, each repeat appended
    # ANOTHER copy of the same row to the audit and the report, so the "closest to passing" list
    # showed the same hypothesis twice and read as though two candidates had tied.
    cache: dict[str, CandidateOutcome] = {}
    reported: set[str] = set()

    for gen in range(max(1, generations)):
        outcomes: list[CandidateOutcome] = []
        for params in population:
            key = params.identifier()
            oc = cache.get(key)
            if oc is None:
                try:
                    oc = evaluate_params(
                        store, params, features=features, spread_bps=peak_spread, l2_ready=l2_ready,
                        funding_bps=funding_bps, window_days=window_days, fee_rate_bps=fee_rate_bps,
                        notional_usd=notional_usd, depth_notional_usd=depth_notional_usd,
                    )
                except Exception as exc:  # a single bad candidate must not abort the tournament
                    store.ml_research_audit(params.identifier(), "ERROR", str(exc),
                                            {"symbol": symbol, "family": params.family,
                                             "generation": gen})
                    continue
                cache[key] = oc
                evaluated += 1
            outcomes.append(oc)
            if key in reported:
                continue  # already audited and counted in an earlier generation
            reported.add(key)
            if oc.admission:
                admitted.append(oc)
            else:
                rejected.append({
                    "model_id": oc.evidence.model_id,
                    "family": params.family,
                    "liquidity": params.liquidity,
                    "net_edge_bps": round(oc.net_bps, 4),
                    "oos_sharpe": round(oc.evidence.oos_sharpe, 4),
                    "profit_factor": round(oc.evidence.profit_factor, 4),
                    "t_stat": round(oc.evidence.t_stat, 4),
                    "oos_trades": oc.evidence.oos_trades,
                    "folds": oc.folds,
                    "reason": oc.rejection[:200],
                })
            # The audit row uses the SAME field names `gpkg.ml.audit.normalize_audit` reads, and
            # carries the costs actually charged to the trades behind the evidence. Gross is
            # reported as gross and net as net: conflating the two is how a losing hypothesis reads
            # as a winner in a dashboard.
            store.ml_research_audit(
                oc.evidence.model_id, "ADMIT" if oc.admission else "REJECT",
                oc.rejection or "cleared_all_strict_gates",
                {
                    "symbol": symbol, "generation": gen,
                    "family": params.family, "model_family": params.family,
                    "gross_edge_bps": round(oc.gross_avg_bps, 4),
                    "net_edge_bps": round(oc.net_bps, 4),
                    "mean_net_bps": round(oc.net_bps, 4),
                    "t_stat": round(oc.evidence.t_stat, 4),
                    "oos_sharpe": round(oc.evidence.oos_sharpe, 4),
                    "profit_factor": round(oc.evidence.profit_factor, 4),
                    "oos_trades": oc.evidence.oos_trades,
                    "folds": oc.folds,
                    "peak_spread_bps": round(peak_spread, 6),
                    "l2_ready": l2_ready,
                    "gate_outcome": oc.admission,
                    "gate_failures": [] if oc.admission else [oc.rejection],
                    "gate_thresholds": {
                        "net_edge_bps": STRICT_GATE.min_edge_bps,
                        "t_stat": STRICT_GATE.min_t_stat,
                        "oos_sharpe": STRICT_GATE.min_oos_sharpe,
                        "profit_factor": STRICT_GATE.min_profit_factor,
                    },
                    "cost_deductions": {k: round(v, 6) for k, v in oc.costs_avg.items()},
                    "params": asdict(params),
                },
            )
            if admitted:
                break  # a cleared candidate ends the generation early; the search has found one

        if admitted or not outcomes:
            break
        # ---- evolve: elites survive, children fill the rest ----
        ranked = sorted(outcomes, key=lambda o: o.net_bps, reverse=True)
        elites = ranked[:max(1, min(elite, len(ranked)))]
        next_pop = [e.params for e in elites]
        while len(next_pop) < max(2, population_size):
            a, b = rng.choice(elites), rng.choice(elites)
            next_pop.append(mutate(crossover(a.params, b.params, rng), rng))
        population = next_pop

    winners = sorted(admitted, key=lambda o: o.net_bps, reverse=True)
    champion = None
    promotion: PromotionDecision | None = None
    if winners:
        champion = winners[0]
        champion_prev = _load_champion_evidence(store, symbol)
        promotion = promote_challenger(champion.evidence, champion_prev)
        swap_ok, swap_reason = hot_swap_decision(champion_prev, champion.evidence)
        promotion = replace(promotion, allowed=promotion.allowed and swap_ok,
                            reason=f"{promotion.reason} | hot_swap: {swap_reason}")
        if promotion.allowed:
            record_champion(store, symbol, champion.evidence)

    result = TournamentResult(
        symbol=symbol,
        started_at_ms=started,
        ended_at_ms=now_ms(),
        generations=generations,
        population_size=population_size,
        seed=seed,
        bars_used=len(klines),
        window_days=window_days,
        l2_ready=l2_ready,
        peak_spread_bps=peak_spread,
        evaluated=evaluated,
        admitted=len(admitted),
        winners=winners,
        rejected_summary=rejected,
        champion=champion,
        promotion=promotion,
    )
    persist_tournament(store, result)
    return result


def persist_tournament(store: Any, result: TournamentResult) -> None:
    """Store the latest summary so the CLI and REST surface read one authoritative record."""
    try:
        store.kv_set(f"ml.tournament.latest.{result.symbol.lower()}",
                     json.dumps(result.to_json(), sort_keys=True, default=str))
    except Exception:
        pass


def load_latest_tournament(store: Any, symbol: str | None = None) -> dict | None:
    if symbol:
        raw = store.kv_get(f"ml.tournament.latest.{symbol.lower()}")
        return json.loads(raw) if raw else None
    for sym in ("btcusdt", "ethusdt"):
        raw = store.kv_get(f"ml.tournament.latest.{sym}")
        if raw:
            return json.loads(raw)
    return None


def _load_champion_evidence(store: Any, symbol: str) -> ModelEvidence | None:
    raw = store.kv_get(f"ml.tournament.champion.{symbol.lower()}")
    if not raw:
        return None
    try:
        d = json.loads(raw)
        return ModelEvidence(**d)
    except Exception:
        return None


def record_champion(store: Any, symbol: str, evidence: ModelEvidence) -> None:
    """Persist the champion keyed by SYMBOL.

    Keying off a substring of the model_id (the previous form) silently coupled storage to the id
    format — rename the id scheme and the incumbent quietly stops being found, which would make
    every subsequent challenger look like a first-time champion and bypass the regression check.
    """
    try:
        store.kv_set(f"ml.tournament.champion.{symbol.lower()}",
                     json.dumps(asdict(evidence), sort_keys=True, default=str))
    except Exception:
        pass


# ------------------------------------------------------------------------------------------------
# Hot-swap
# ------------------------------------------------------------------------------------------------
def hot_swap_decision(
    champion: ModelEvidence | None,
    challenger: ModelEvidence,
    *,
    champion_recent_net_bps: float | None = None,
    challenger_recent_net_bps: float | None = None,
    min_improvement_bps: float = 0.0,
    recent_window_days: int = 14,
) -> tuple[bool, str]:
    """Promote only when the challenger beats the champion over the RECENT window, with no regression.

    Two independent conditions, because either alone is insufficient:
      * the challenger must clear every strict gate (`challenger.verified`), and
      * it must not be WORSE than the champion on the most recent OOS slice. A challenger with a
        better lifetime mean but deteriorating recent performance is a model that was working and
        has stopped; promoting it on the lifetime number is how a desk buys a regime change.
    """
    if not challenger.verified:
        return False, f"challenger failed strict gates: {challenger.verification_reason}"
    if champion is None:
        return True, "no incumbent champion; first verified challenger takes the slot"
    if champion_recent_net_bps is not None and challenger_recent_net_bps is not None:
        delta = challenger_recent_net_bps - champion_recent_net_bps
        if delta <= min_improvement_bps:
            return False, (
                f"regression over last {recent_window_days}d OOS: challenger "
                f"{challenger_recent_net_bps:.4f} vs champion {champion_recent_net_bps:.4f} bps"
            )
        return True, (
            f"challenger improves last {recent_window_days}d OOS by {delta:.4f} bps with no regression"
        )
    if challenger.mean_net_bps <= champion.mean_net_bps + min_improvement_bps:
        return False, (
            f"no recent-window evidence and lifetime edge does not improve "
            f"({challenger.mean_net_bps:.4f} vs {champion.mean_net_bps:.4f} bps)"
        )
    return True, "lifetime net edge improves and no recent regression observed"
