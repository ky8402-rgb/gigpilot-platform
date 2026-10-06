"""ADAPTIVE VPIN BUCKET SIZING — one bucket size per instrument, derived from its own ADV.

WHY A FLAT DEFAULT IS NOT MERELY SUBOPTIMAL, BUT WRONG
------------------------------------------------------
VPIN is computed over CONSTANT-VOLUME buckets: every sample carries exactly V units of traded
volume, and the measure is the average imbalance across the last N of them. V is therefore not a
tuning knob, it is the SAMPLING RATE of the measurement, and the sampling rate has to be right for
the instrument.

The build this replaces sized every symbol at a flat 25 base units. Read that as a dollar figure and
the problem is plain:

  * 25 BTC  -> roughly $1.5M-$1.8M of volume per bucket. At BTC's ADV that is a handful of buckets
    per day, so a "50 bucket" window spans weeks and the engine cannot react to anything.
  * 25 SOL  -> roughly $4k per bucket. SOL prints that in well under a second, so nearly every
    bucket is a single trade and the "imbalance" being averaged is one print's aggression — tick
    noise wearing a toxicity label.

The same constant is thus far too coarse on one instrument and far too fine on another. No single
value can be correct, which is why this module derives it per symbol instead of guessing again.

THE RULE
--------
    V = ADV_24h / BUCKETS_PER_DAY

with BUCKETS_PER_DAY = 50, so a full window is about one trading day. This is the standard
volume-clock construction: more liquid instruments get proportionally larger buckets, and the number
of samples per day is roughly constant, which is what makes the measure comparable across symbols
and across regimes.

ADV comes from the venue's own recent 24h of klines. That is PUBLIC market data — no credential is
required to read it — which is why bootstrap works even in AWAITING_SECRET, before any secret has
been supplied.

PRECEDENCE, AND WHY IT IS THIS ORDER
------------------------------------
    1. GIGPILOT_VPIN_BUCKET_<SYMBOL>  — an explicit operator override always wins. Someone who has
       measured this instrument knows more than the estimator does.
    2. ADV-derived                    — the normal path.
    3. per-symbol documented fallback — ADV unavailable (venue unreachable, empty kline response).
    4. generic fallback               — unknown symbol AND no ADV. Deliberately small, and it logs
       loudly, because a wrong bucket size is silent by nature: it does not raise, it just measures
       something else.

Every resolution returns the SOURCE alongside the value. A bucket size that came from a fallback is
a degraded measurement, and the only way an operator can tell is if the system says so.
"""
from __future__ import annotations

from typing import Any, Optional, Sequence

#: Target samples per 24-hour cycle. A full VPIN window (window_buckets = 50) is then ~1 trading day.
BUCKETS_PER_DAY = 50

#: Bybit kline interval/limit that spans exactly 24h: 288 x 5m bars.
KLINE_INTERVAL = "5"
KLINE_LOOKBACK_BARS = 288
DAY_MS = 86_400_000

#: Documented per-instrument fallbacks, in BASE units, for when ADV cannot be measured.
#:
#: These are the figures the operating notes quote, and they are chosen to land in the same notional
#: band as the ADV rule would (~$150k-$400k per bucket), NOT copied from the deprecated flat default:
#:     BTCUSDT 5.0  BTC  ~= $300k-$400k per bucket at BTC's mid-60k-$70k range
#:     ETHUSDT 50.0 ETH ~= $150k-$200k per bucket
FALLBACK_BUCKET_VOLUME: dict[str, float] = {
    "BTCUSDT": 5.0,
    "ETHUSDT": 50.0,
}

#: Last resort for a symbol with neither an override nor measurable ADV. Small on purpose: too-small
#: buckets over-sample but still measure real flow, whereas too-large buckets can leave the measure
#: permanently unavailable, and an unavailable risk signal fails open in the caller's mind. The
#: resolution logs a warning and reports the source, so the operator can size it properly.
GENERIC_FALLBACK_BUCKET_VOLUME = 1.0

SOURCE_OVERRIDE = "env_override"
SOURCE_ADV = "adv_24h"
SOURCE_FALLBACK_SYMBOL = "fallback_symbol"
SOURCE_FALLBACK_GENERIC = "fallback_generic"


def bucket_volume_from_adv(adv_24h: Optional[float]) -> Optional[float]:
    """V = ADV_24h / BUCKETS_PER_DAY, or None when ADV is not usable.

    None rather than a default: an unmeasurable ADV is not a measurement of zero, and silently
    substituting a number here would erase the distinction the caller reports to the operator.
    """
    if adv_24h is None:
        return None
    try:
        adv = float(adv_24h)
    except (TypeError, ValueError):
        return None
    if not (adv > 0.0) or adv != adv or adv in (float("inf"), float("-inf")):
        return None
    return adv / float(BUCKETS_PER_DAY)


def adv_from_klines(
    rows: Sequence[Sequence[Any]],
    *,
    now_ms_value: Optional[int] = None,
    window_ms: int = DAY_MS,
) -> Optional[float]:
    """Sum the BASE volume of the last `window_ms` of klines. None when nothing is usable.

    Bybit returns klines NEWEST FIRST as `[startMs, open, high, low, close, volume, turnover]`, so
    rows are filtered by their own timestamp rather than by position — a venue that changes ordering
    or returns a short page would otherwise silently shift the window.

    `now_ms_value` defaults to the newest bar's own timestamp rather than the wall clock, so the
    function stays pure and testable and does not depend on when it happens to be called.
    """
    parsed: list[tuple[int, float]] = []
    for row in rows or ():
        if not row or len(row) < 6:
            continue
        try:
            ts = int(row[0])
            vol = float(row[5])
        except (TypeError, ValueError):
            continue
        if vol != vol or vol < 0 or vol in (float("inf"), float("-inf")):
            continue
        parsed.append((ts, vol))
    if not parsed:
        return None
    reference = int(now_ms_value) if now_ms_value is not None else max(ts for ts, _ in parsed)
    cutoff = reference - int(window_ms)
    # HALF-OPEN (cutoff, reference], and the strictness is load-bearing rather than cosmetic. Bars
    # sit on a grid, so the 24h instant usually falls BETWEEN two of them: with `>=`, a 48h page
    # yields 289 five-minute bars instead of 288 and the ADV is overstated by one bar (~0.35%),
    # which then sizes every bucket slightly too large. `>` makes the window exactly 24h of bars.
    total = sum(vol for ts, vol in parsed if ts > cutoff)
    if total <= 0:
        return None
    return total


def resolve_bucket_volume(
    symbol: str,
    *,
    adv_24h: Optional[float] = None,
    override: Optional[float] = None,
) -> tuple[float, str]:
    """Resolve the bucket volume for `symbol` and report WHERE it came from.

    Returns `(bucket_volume_in_base_units, source)`. The source is part of the return value, not a
    log line, because the caller has to surface it: a fallback-sized bucket is a degraded
    measurement and pretending otherwise is how a wrong sampling rate goes unnoticed for weeks.
    """
    sym = str(symbol or "").strip().upper()

    if override is not None:
        try:
            v = float(override)
        except (TypeError, ValueError):
            v = 0.0
        if v > 0:
            return v, SOURCE_OVERRIDE

    from_adv = bucket_volume_from_adv(adv_24h)
    if from_adv is not None:
        return from_adv, SOURCE_ADV

    if sym in FALLBACK_BUCKET_VOLUME:
        return float(FALLBACK_BUCKET_VOLUME[sym]), SOURCE_FALLBACK_SYMBOL

    return float(GENERIC_FALLBACK_BUCKET_VOLUME), SOURCE_FALLBACK_GENERIC


def is_degraded_source(source: str) -> bool:
    """True when the bucket size did NOT come from a measurement of this instrument.

    Useful to callers that want to alarm or annotate: an operator override is intentional and counts
    as deliberate, so it is not degraded.
    """
    return source in {SOURCE_FALLBACK_SYMBOL, SOURCE_FALLBACK_GENERIC}


def describe_resolution(symbol: str, volume: float, source: str, adv_24h: Optional[float]) -> str:
    """One-line, secret-free explanation for logs and telemetry."""
    sym = str(symbol or "").strip().upper()
    adv_txt = "n/a" if adv_24h is None else f"{float(adv_24h):.4f}"
    if source == SOURCE_ADV:
        return (f"{sym}: bucket_volume={volume:.6f} base units from 24h ADV {adv_txt} "
                f"(ADV/{BUCKETS_PER_DAY})")
    if source == SOURCE_OVERRIDE:
        return f"{sym}: bucket_volume={volume:.6f} base units from GIGPILOT_VPIN_BUCKET_{sym} override"
    if source == SOURCE_FALLBACK_SYMBOL:
        return (f"{sym}: bucket_volume={volume:.6f} base units from the documented fallback "
                f"(24h ADV unavailable) — degraded, intended as a floor not a tuning")
    return (f"{sym}: bucket_volume={volume:.6f} base units from the GENERIC fallback — DEGRADED "
            f"(24h ADV unavailable AND no documented fallback for this instrument, so this size was "
            f"never derived from this market at all) — set GIGPILOT_VPIN_BUCKET_{sym} to size it "
            f"properly")
