"""VPIN — Volume-Synchronised Probability of Informed Trading, and its quoting policy.

WHAT IT MEASURES
----------------
VPIN estimates the fraction of volume that is INFORMATION-MOTIVATED rather than noise. The intuition
is not subtle and it is exactly the risk this platform has been trying to price since the friction
model was written: when one side of the market knows something, it trades consistently in one
direction, order flow becomes one-sided, and anyone resting a passive quote on the other side gets
filled precisely when they should not. That is adverse selection, and VPIN is its measurable proxy.

    VPIN = sum_{t=1..N} |V_t^B - V_t^S| / (N * V)

Volume is split into CONSTANT-VOLUME buckets of size V rather than fixed time windows. This is the
whole point of the construction: on a bank of clocks, an information event that lasts two seconds and
one that lasts two minutes look identical, and a quiet hour contributes as much as a violent one.
Bucketing by traded volume samples the market in the units that actually matter — trades — so the
measure is comparable across regimes.

WHY THE BAR IS THE ROLLING 90TH PERCENTILE
------------------------------------------
A raw VPIN number is not actionable on its own: "0.31" means nothing without knowing what 0.31 means
for THIS instrument at THIS time. Volatility, tick size and typical order size all vary by symbol and
by regime, so a hardcoded threshold would be either always-on for one instrument or never-on for
another. The threshold is therefore the instrument's OWN rolling 90th percentile: toxicity is
"unusually one-sided FOR THIS MARKET RIGHT NOW", which is the question worth asking.

FAIL-CLOSED ON UNKNOWN
----------------------
Every method returns a value that makes the caller MORE cautious, never less, when information is
missing:
  * `vpin` is None until N complete buckets exist, and `is_high_toxicity` is False for None — but the
    caller is told the measure is unavailable rather than being told the book is clean;
  * the percentile is None until enough history exists to compute it, and until then no widening or
    pausing is triggered, because a percentile of three samples is not a threshold.

That last choice is a deliberate asymmetry: with no evidence of toxicity we quote normally, because
refusing to quote at all until an arbitrary amount of history accumulates would be a far larger cost
than the adverse selection it avoids. What we never do is treat ABSENCE of data as evidence of calm.

NO THIRD-PARTY DEPENDENCIES
---------------------------
Like the rest of the strategy package this runs on the trading path, inside the process holding live
exchange credentials. Statistics here are hand-rolled and O(1) amortised per trade.
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, replace

#: DEPRECATED — do not use for new wiring.
#:
#: A flat 25 base units is not a neutral placeholder; it is a bucket size that is simultaneously far
#: too coarse on BTC (25 BTC is ~$1.6M, so a "50 bucket" window spans weeks and the measure barely
#: updates) and far too fine on SOL (25 SOL is ~$4k, which prints in well under a second and yields
#: single-trade buckets that average tick noise rather than toxicity). Bucket size is the SAMPLING
#: RATE of the measurement and is therefore per-instrument by construction — the platform derives it
#: from each symbol's 24h ADV in `gpkg/strategy/vpin_calibration.py`.
#:
#: Retained only as the `VpinConfig` dataclass default so engines constructed explicitly (and the
#: tests that pin those constructions) keep working. No production path resolves to this value.
DEFAULT_BUCKET_VOLUME = 25.0
DEFAULT_WINDOW_BUCKETS = 50
DEFAULT_PERCENTILE = 90.0
DEFAULT_HISTORY = 500


@dataclass(frozen=True)
class VpinConfig:
    """Bucketing and threshold parameters.

    `bucket_volume` is in BASE units (e.g. BTC), not USD, so it must be chosen per instrument: a
    bucket that takes an hour to fill on BTCUSDT makes the measure useless on a quiet day, and one
    that fills in milliseconds on a thin altcoin produces a string of single-trade buckets that
    measure noise.

    The default here is DEPRECATED and exists only for explicitly-constructed engines; production
    wiring resolves the value per symbol from 24h ADV via `gpkg/strategy/vpin_calibration.py` and
    hands it in.
    """

    bucket_volume: float = DEFAULT_BUCKET_VOLUME
    window_buckets: int = DEFAULT_WINDOW_BUCKETS
    percentile: float = DEFAULT_PERCENTILE
    history: int = DEFAULT_HISTORY
    # The percentile needs a population before it means anything. Below this many samples the
    # threshold is reported as unavailable rather than computed from a handful of points.
    min_history_for_threshold: int = 50
    # How many of the MOST RECENT VPIN readings to EXCLUDE from the threshold's own population.
    # 0 means "use `window_buckets`".
    #
    # WHAT THIS DOES AND DOES NOT BUY, MEASURED RATHER THAN ASSUMED. Consecutive VPIN readings share
    # all but one of their buckets, so they are autocorrelated and a burst does drag its own baseline
    # upward. Excluding the newest readings keeps them out of that population, which makes the
    # threshold more sensitive at the ONSET of a burst.
    #
    # It is NOT what guarantees detection. That is `absolute_toxic_vpin`: mutating this lag to zero
    # did not break any test, because for every sustained burst the absolute floor fires regardless.
    # The lag is kept as a cheap sensitivity improvement — not described as a correctness requirement,
    # because it demonstrably is not one.
    threshold_lag_buckets: int = 0
    # ABSOLUTE FLOOR the adaptive baseline may never rise above. THIS is the guarantee.
    #
    # An adaptive percentile adapts to a SUSTAINED regime: if flow stays one-sided long enough, the
    # burst becomes the population and the threshold climbs to meet it, so detection switches off
    # exactly when the market is most dangerous. No amount of history should make "almost every print
    # was a buy" count as normal. The effective threshold is therefore min(rolling_p90, this), and
    # 0.90 means toxicity is declared unconditionally above 90% one-sidedness.
    absolute_toxic_vpin: float = 0.90
    # Fractions of the way from the threshold to 1.0 at which quoting is widened, then paused.
    widen_fraction: float = 0.25
    pause_fraction: float = 0.60
    # Extra ticks of protection applied when quoting through toxicity.
    max_widen_ticks: int = 3


@dataclass
class _Bucket:
    buy: float = 0.0
    sell: float = 0.0

    @property
    def volume(self) -> float:
        return self.buy + self.sell

    @property
    def imbalance(self) -> float:
        return abs(self.buy - self.sell)


class VpinEngine:
    """Constant-volume-bucketed VPIN for ONE instrument.

    Feed it every public trade. It is intentionally not a sampler: skipping trades to save CPU would
    bias the buckets, and the buckets are the measurement.
    """

    def __init__(self, config: VpinConfig | None = None) -> None:
        self.cfg = config or VpinConfig()
        if self.cfg.bucket_volume <= 0:
            raise ValueError("bucket_volume must be positive")
        if self.cfg.window_buckets <= 0:
            raise ValueError("window_buckets must be positive")
        # Completed buckets, most recent last. `window_buckets + 1` so a partial completion does not
        # momentarily shrink the window used for the VPIN sum.
        self._buckets: deque[_Bucket] = deque(maxlen=self.cfg.window_buckets)
        self._open = _Bucket()
        self._vpin_history: deque[float] = deque(maxlen=max(1, self.cfg.history))
        self._last_price = 0.0
        self._last_side = ""
        self._trades = 0

    def recalibrate(self, bucket_volume: float) -> None:
        """Adopt a new bucket size, taken from this instrument's measured ADV at boot.

        LEGAL ONLY BEFORE INGESTION HAS BEGUN, and the guard is not defensive padding. Completed
        buckets were filled to the OLD size, and `vpin` divides their imbalance by
        `n * bucket_volume`. Mixing two sizes would silently scale the denominator away from the
        volumes actually measured, producing a number that is not VPIN at any size — the failure
        would be invisible, because a wrong VPIN still looks like a plausible VPIN.

        The engine is recalibrated in place rather than replaced so the containing `{symbol: engine}`
        mapping keeps its identity: `BybitWS.vpin` is iterated for telemetry and read by the strategy
        loop, and swapping engine objects under those readers is how a live path ends up holding a
        stale reference.
        """
        v = float(bucket_volume)
        if not (v > 0) or v != v or v in (float("inf"), float("-inf")):  # noqa: PLR0124 — canonical NaN test on an already-coerced float, not a self-comparison
            raise ValueError("bucket_volume must be positive and finite")
        if self._trades or self._buckets:
            raise RuntimeError(
                "cannot recalibrate after ingestion has begun: existing buckets were filled at the "
                "previous size and would be summed against a different denominator"
            )
        self.cfg = replace(self.cfg, bucket_volume=v)

    # ------------------------------------------------------------------ ingestion
    def on_trade(self, *, price: float, size: float, side: str = "", ts_ms: int = 0) -> None:
        """Consume one print.

        `side` should be the AGGRESSOR side when the venue provides it (Bybit's `S` on publicTrade,
        which fast-tracks buy/sell intent). When it is absent or unrecognised the tick rule is used:
        an uptick is a buy, a downtick a sell, and an unchanged price inherits the previous
        classification. Inferring is strictly worse than being told, so the venue's own label always
        wins when it is there.
        """
        _ = ts_ms  # retained for signature symmetry with other feeds; bucketing is volume-based
        px = float(price)
        sz = float(size)
        if not (px > 0) or not (sz > 0) or not math.isfinite(px) or not math.isfinite(sz):
            return
        buy = classify_trade(side, px, self._last_price, self._last_side)
        self._last_side = "Buy" if buy else "Sell"
        self._last_price = px
        self._trades += 1

        remaining = sz
        # A single print can exceed the bucket size, so it is split across buckets. Treating it as
        # one indivisible bucket would create a bucket far larger than V and distort the denominator.
        while remaining > 0:
            space = self.cfg.bucket_volume - self._open.volume
            if space <= 0:
                self._close_bucket()
                space = self.cfg.bucket_volume
            take = min(remaining, space)
            if buy:
                self._open.buy += take
            else:
                self._open.sell += take
            remaining -= take
            if self._open.volume >= self.cfg.bucket_volume - 1e-12:
                self._close_bucket()

    def _close_bucket(self) -> None:
        self._buckets.append(self._open)
        self._open = _Bucket()
        v = self.vpin
        if v is not None:
            self._vpin_history.append(v)

    # ------------------------------------------------------------------ measure
    @property
    def vpin(self) -> float | None:
        """VPIN over the last N complete buckets, or None until N exist.

        None rather than 0.0: zero would assert "perfectly balanced flow", which is a claim we cannot
        make before a full window has been observed.
        """
        n = self.cfg.window_buckets
        if len(self._buckets) < n:
            return None
        total = sum(b.imbalance for b in self._buckets)
        denom = n * self.cfg.bucket_volume
        return total / denom if denom > 0 else None

    @property
    def bucket_count(self) -> int:
        return len(self._buckets)

    @property
    def trade_count(self) -> int:
        return self._trades

    def threshold(self) -> float | None:
        """The rolling percentile that defines 'unusually toxic' for this instrument.

        Computed over history with the most recent `threshold_lag_buckets` readings REMOVED, so the
        current regime cannot define the baseline it is judged against. Without that exclusion the
        percentile is self-referential and a sustained burst silently disables detection.

        None until `min_history_for_threshold` samples survive the exclusion. A percentile of a
        handful of points is not a threshold, and treating it as one would flip quoting on noise.
        """
        lag = self.cfg.threshold_lag_buckets or self.cfg.window_buckets
        hist = list(self._vpin_history)
        if lag > 0:
            hist = hist[:-lag] if len(hist) > lag else []
        if len(hist) < self.cfg.min_history_for_threshold:
            return None
        return _percentile(sorted(hist), self.cfg.percentile)

    def effective_threshold(self) -> float | None:
        """min(rolling p90, absolute floor).

        The floor is what stops a sustained burst from raising the bar out of reach. It is applied
        here rather than at each call site so `is_high_toxicity`, `widen_ticks` and `should_pause`
        cannot disagree about what "toxic" means.
        """
        t = self.threshold()
        floor = float(self.cfg.absolute_toxic_vpin)
        if t is None:
            return None
        return min(t, floor)

    @property
    def is_high_toxicity(self) -> bool:
        """True when VPIN exceeds the effective threshold (rolling p90, floored)."""
        v, t = self.vpin, self.effective_threshold()
        if v is None or t is None:
            return False
        return v > t

    def widen_ticks(self) -> int:
        """How many extra ticks of protection to put between us and the touch.

        Scales with how far VPIN sits above the threshold, so the response is proportional rather
        than a step function — a marginal reading should not trigger the same retreat as an extreme
        one.
        """
        v, t = self.vpin, self.effective_threshold()
        if v is None or t is None or v <= t:
            return 0
        span = max(1e-9, 1.0 - t)
        frac = (v - t) / span
        if frac < self.cfg.widen_fraction:
            return 0
        scaled = (frac - self.cfg.widen_fraction) / max(1e-9, 1.0 - self.cfg.widen_fraction)
        return max(1, min(self.cfg.max_widen_ticks, int(math.ceil(scaled * self.cfg.max_widen_ticks))))

    def should_pause(self) -> bool:
        """True when flow is so one-sided that NOT quoting is the better trade.

        Resting a quote into extreme toxicity is close to a guaranteed adverse fill: the counterparty
        is trading on information and we are the liquidity they consume. Declining to quote costs
        nothing but the opportunity.
        """
        v, t = self.vpin, self.effective_threshold()
        if v is None or t is None or v <= t:
            return False
        span = max(1e-9, 1.0 - t)
        return ((v - t) / span) >= self.cfg.pause_fraction

    def snapshot(self) -> dict:
        """Telemetry payload. Contains no secret and no raw trade data.

        Reports BOTH the raw percentile and the floored threshold actually used, so an operator can
        see whether a pause came from unusual flow for this instrument or from the absolute floor —
        two situations that call for different responses.
        """
        v, t = self.vpin, self.threshold()
        eff = self.effective_threshold()
        return {
            "vpin": None if v is None else round(v, 6),
            "threshold_p90": None if t is None else round(t, 6),
            "effective_threshold": None if eff is None else round(eff, 6),
            "buckets": self.bucket_count,
            "window": self.cfg.window_buckets,
            "trades": self._trades,
            "high_toxicity": self.is_high_toxicity,
            "widen_ticks": self.widen_ticks(),
            "pause": self.should_pause(),
        }


def classify_trade(side: str, price: float, last_price: float, last_side: str) -> bool:
    """True for a buyer-aggressed print.

    The venue's label wins. Only when it is missing does the tick rule apply, and an unchanged price
    inherits the previous side rather than defaulting — defaulting to 'buy' on every flat print would
    manufacture a systematic one-sided bias in exactly the low-volatility conditions where VPIN is
    most easily misled.
    """
    s = str(side or "").strip().lower()
    if s in {"buy", "b", "bid"}:
        return True
    if s in {"sell", "s", "ask"}:
        return False
    if last_price > 0:
        if price > last_price:
            return True
        if price < last_price:
            return False
    return str(last_side).strip().lower() in {"buy", "b", "bid"}


def _percentile(ordered: list[float], q: float) -> float:
    """Linear-interpolation percentile on an already-sorted list."""
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return ordered[0]
    qq = max(0.0, min(100.0, float(q))) / 100.0
    pos = qq * (len(ordered) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(ordered) - 1)
    if lo == hi:
        return ordered[lo]
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (pos - lo)


@dataclass
class ToxicityPolicy:
    """Quoting response derived from a VPIN snapshot. Pure data, so the executor can be tested
    against it without a live book."""

    pause: bool = False
    widen_ticks: int = 0
    vpin: float | None = None
    threshold: float | None = None
    reason: str = ""

    @property
    def is_restrictive(self) -> bool:
        return self.pause or self.widen_ticks > 0


def toxicity_policy(engine: VpinEngine | None) -> ToxicityPolicy:
    """Translate the coin into a quoting decision. Absent engine = no restriction."""
    if engine is None:
        return ToxicityPolicy(reason="no_vpin_engine")
    snap = engine.snapshot()
    thr = snap["effective_threshold"]
    if snap["pause"]:
        return ToxicityPolicy(pause=True, widen_ticks=int(snap["widen_ticks"]),
                              vpin=snap["vpin"], threshold=thr,
                              reason="vpin_extreme_pause_quoting")
    if snap["widen_ticks"] > 0:
        return ToxicityPolicy(widen_ticks=int(snap["widen_ticks"]), vpin=snap["vpin"],
                              threshold=thr, reason="vpin_elevated_widen_quote")
    return ToxicityPolicy(vpin=snap["vpin"], threshold=thr, reason="normal")
