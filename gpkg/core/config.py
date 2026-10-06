"""Configuration and credential hydration for the GigPilot trading engine.

Enforces:
  - Exact live Bybit host (forbidden keywords like testnet/paper/sim immediately exit).
  - Credentials must be present (via env, AWS Secrets Manager, or local keyfiles).
  - Explicit symbols parsing.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field

LIVE_HOST = "https://api.bybit.com"
WS_PUBLIC = "wss://stream.bybit.com/v5/public/linear"
WS_PRIVATE = "wss://stream.bybit.com/v5/private"
FORBIDDEN = ("testnet", "demo", "paper", "sim", "mock", "fake")


def _maybe_load_aws_secret() -> None:
    arn = os.getenv("BYBIT_SECRET_ARN", "").strip()
    if not arn:
        return
    try:
        import boto3  # type: ignore
        client = boto3.client("secretsmanager", region_name=os.getenv("AWS_REGION", "us-east-1"))
        payload = json.loads(client.get_secret_value(SecretId=arn)["SecretString"])
    except Exception as e:
        print(f"FATAL: cannot read secret {arn}: {e}", file=sys.stderr)
        sys.exit(2)
    for k in ("BYBIT_API_KEY", "BYBIT_API_SECRET"):
        if k in payload and not os.getenv(k):
            os.environ[k] = str(payload[k])
    print("hydrated Bybit credentials from Secrets Manager", file=sys.stderr)


def _vpin_bucket_overrides(symbols: list[str]) -> dict[str, float]:
    """EXPLICIT `GIGPILOT_VPIN_BUCKET_<SYMBOL>` overrides only.

    An absent symbol means "no override", and the platform then derives the bucket size from that
    instrument's measured 24h ADV at boot (`gpkg/strategy/vpin_calibration.py`), falling back per
    symbol when ADV cannot be read. This mapping used to be pre-populated with a flat 25.0 for every
    symbol; that default is gone because bucket size is the SAMPLING RATE of the measure and no
    single value can be right for both BTC and a thin alt.

    A malformed or non-positive override is a hard refusal rather than a silent fallback to the
    derived size. An operator who set this variable meant to pin the bucket size; quietly ignoring a
    typo would leave them believing a value was in force when it was not.
    """
    out: dict[str, float] = {}
    for sym in symbols:
        raw = os.getenv(f"GIGPILOT_VPIN_BUCKET_{sym}", "").strip()
        if not raw:
            continue
        try:
            value = float(raw)
        except ValueError:
            print(f"FATAL: GIGPILOT_VPIN_BUCKET_{sym} is not a number: {raw!r}", file=sys.stderr)
            sys.exit(2)
        if not (value > 0) or value != value or value in (float("inf"), float("-inf")):
            print(f"FATAL: GIGPILOT_VPIN_BUCKET_{sym} must be positive and finite: {raw!r}",
                  file=sys.stderr)
            sys.exit(2)
        out[sym] = value
    return out


def _maybe_load_local_keys() -> tuple[str, str]:
    key = os.getenv("BYBIT_API_KEY", "").strip()
    secret = os.getenv("BYBIT_API_SECRET", "").strip()
    if not key or not secret:
        try:
            for candidate in [".bybit-quant-keys.json", ".env"]:
                if os.path.exists(candidate):
                    if candidate.endswith(".json"):
                        with open(candidate, "r") as cf:
                            kd = json.load(cf)
                            key = key or kd.get("apiKey", "").strip()
                            secret = secret or kd.get("apiSecret", "").strip()
                    else:
                        with open(candidate, "r") as cf:
                            for line in cf:
                                if line.startswith("BYBIT_API_KEY="):
                                    key = key or line.split("=", 1)[1].strip().strip('"').strip("'")
                                elif line.startswith("BYBIT_API_SECRET="):
                                    secret = secret or line.split("=", 1)[1].strip().strip('"').strip("'")
        except Exception:
            pass
    return key, secret


@dataclass
class Config:
    api_key: str
    # repr=False is a SECURITY control, not cosmetics. A dataclass renders every field in its
    # generated __repr__, so `log.info("cfg=%s", cfg)` — or any traceback that prints the object —
    # would publish the live API secret verbatim. With repr=False that same line is safe.
    api_secret: str = field(repr=False)
    symbols: list[str]
    api_passphrase: str = field(default="", repr=False)
    # When True the API secret MUST come from the runtime store (entered by hand at arm time) and
    # `api_secret` here is empty by construction. Any signed request without a runtime secret raises
    # rather than falling back — see `BybitREST._secret`.
    require_runtime_secret: bool = False
    host: str = LIVE_HOST
    ws_public: str = WS_PUBLIC
    ws_private: str = WS_PRIVATE
    arm: bool = False
    execution_mode: str = "paper"
    live_armed: bool = False
    recv_window: str = "5000"
    edge_hurdle_bps: float = 3.0
    fee_ceiling_bps: float = 8.0
    slippage_factor: float = 0.5
    # Bybit's /v5/account/fee-rate reports the fee PER SIDE. A completed trade pays it on entry AND
    # on exit, so the edge model must charge it twice or it understates the cost of every round trip
    # by one full fee unit (~5.5 bps at VIP0 taker). Kept as a knob rather than a literal so the
    # multiplier is explicit and testable.
    fee_round_trip_multiple: float = 2.0
    # Adverse-selection cost as a fraction of the quoted spread.
    #
    # NOT CALIBRATED — there is no live fill data to calibrate against, so this is a deliberately
    # conservative structural term rather than a measured one. It is expressed as a fraction of the
    # spread because the spread is exchange-derived (not invented) and bounds the cost of being
    # adversely filled for a taker. Set to 0.0 ONLY with evidence that adverse selection is
    # immaterial; leaving it unset previously meant the term was silently absent from the model.
    adverse_selection_factor: float = 0.5
    max_leverage: float = 3.0
    max_symbol_notional_pct: float = 15.0
    max_gross_notional_pct: float = 40.0
    risk_per_trade_pct: float = 0.5
    max_daily_loss_pct: float = 2.0
    max_open_orders_per_market: int = 3
    taker_min_net_edge_bps: float = 12.0
    # ---- execution routing (see gpkg/execution/routing.py) ----
    # Prefer resting at the micro-price over crossing. Measured on a live BTCUSDT quote: a taker
    # round trip costs 11.0 bps in fees and a maker round trip 4.0 bps, so resting is worth ~7 bps
    # per trade — more than the entire edge hurdle the platform used to trade on.
    #
    # Whether this ENGAGES is decided by the caller supplying a quote: with no usable top-of-book
    # the executor falls back to the existing market path unchanged, so enabling this cannot strand
    # an order without a price to quote at.
    maker_entry_enabled: bool = True
    # Spec: pull and re-quote an unfilled order once it is older than this.
    maker_max_quote_age_ms: int = 2_500
    # Bounded re-quote attempts. Each requote is a new client order id, so the venue can still
    # deduplicate a retry of any single attempt.
    maker_max_requotes: int = 2
    # EXPLICIT VPIN bucket-volume overrides only, in BASE units, keyed by symbol — NOT a default.
    #
    # Bucket size is the SAMPLING RATE of the VPIN measure, so it is instrument-specific by
    # construction: a bucket sized for BTCUSDT fills in milliseconds on a thin altcoin and produces
    # single-trade buckets that measure noise, while the reverse leaves the measure unable to react.
    # This mapping used to be populated with a flat 25.0 for every symbol, which was wrong by orders
    # of magnitude in both directions at once. It is now empty unless an operator explicitly pins a
    # value with GIGPILOT_VPIN_BUCKET_<SYMBOL>=<volume>, and an unset symbol is sized from its own
    # measured 24h ADV (see gpkg/strategy/vpin_calibration.py).
    vpin_bucket_volume: dict = field(default_factory=dict)
    max_signal_to_ack_drift_bps: float = 2.5
    max_concurrent_positions: int = 3
    min_arm_capital_usdt: float = 67.0
    atr_period: int = 14
    stop_atr_mult: float = 2.0
    tp_atr_mult: float = 2.5
    min_stop_bps: float = 15.0
    time_stop_min: int = 240
    staleness_ms: int = 1500
    book_levels: int = 5
    momentum_window_s: int = 30
    signal_fair_shift_bps: float = 2.5
    db_path: str = "gigpilot.db"
    log_level: str = "INFO"

    @staticmethod
    def from_env() -> "Config":
        # §7: when the operator must enter the secret by hand for each armed session, hydrating it
        # from AWS Secrets Manager / .env / .bybit-quant-keys.json is exactly the persisted copy this
        # mode exists to prevent. So hydration is SKIPPED entirely rather than merely overridden — a
        # value that is never read cannot be leaked by a later code path, and skipping it also means
        # the secret never reaches `os.environ` (readable via /proc/self/environ).
        require_runtime = os.getenv("GIGPILOT_REQUIRE_RUNTIME_SECRET", "0") == "1"
        if require_runtime:
            key = os.getenv("BYBIT_API_KEY", "").strip()
            secret = ""
        else:
            _maybe_load_aws_secret()
            key, secret = _maybe_load_local_keys()
        # The API KEY is still required: it is an identifier, not a secret, and signing needs both.
        # The SECRET is only required when it is expected to come from config at all.
        if not key or (not secret and not require_runtime):
            print("FATAL: BYBIT_API_KEY / BYBIT_API_SECRET required.", file=sys.stderr)
            sys.exit(2)
        host = os.getenv("GIGPILOT_HOST", LIVE_HOST).strip()
        if any(x in host.lower() for x in FORBIDDEN) or host != LIVE_HOST:
            print(f"FATAL: host must be exactly {LIVE_HOST}.", file=sys.stderr)
            sys.exit(2)
        syms = [s.strip().upper() for s in os.getenv("GIGPILOT_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",") if s.strip()]
        execution_mode = os.getenv("GIGPILOT_EXECUTION_MODE", "paper").strip().lower()
        live_armed = os.getenv("GIGPILOT_LIVE_ARMED", "0") == "1"
        if not syms:
            print("FATAL: GIGPILOT_SYMBOLS empty.", file=sys.stderr)
            sys.exit(2)
        if execution_mode not in {"paper", "live"}:
            print("FATAL: GIGPILOT_EXECUTION_MODE must be paper or live.", file=sys.stderr)
            sys.exit(2)
        if execution_mode == "live" and not live_armed:
            # Live execution is deliberately fail-closed: configuration alone cannot arm capital.
            print("FATAL: live execution requires GIGPILOT_LIVE_ARMED=1.", file=sys.stderr)
            sys.exit(2)
        return Config(
            api_key=key,
            api_secret=secret,
            require_runtime_secret=require_runtime,
            symbols=syms,
            arm=os.getenv("GIGPILOT_ARM", "0") == "1",
            execution_mode=execution_mode,
            live_armed=live_armed,
            edge_hurdle_bps=float(os.getenv("GIGPILOT_HURDLE_BPS", "3.0")),
            fee_round_trip_multiple=float(os.getenv("GIGPILOT_FEE_ROUND_TRIP_MULTIPLE", "2.0")),
            adverse_selection_factor=float(os.getenv("GIGPILOT_ADVERSE_SELECTION_FACTOR", "0.5")),
            max_leverage=float(os.getenv("GIGPILOT_MAX_LEV", "3.0")),
            max_daily_loss_pct=float(os.getenv("GIGPILOT_MAX_DAILY_LOSS", "2.0")),
            max_open_orders_per_market=int(os.getenv("GIGPILOT_MAX_OPEN_ORDERS_PER_MARKET", "3")),
            taker_min_net_edge_bps=float(os.getenv("GIGPILOT_TAKER_MIN_NET_EDGE_BPS", "12.0")),
            maker_entry_enabled=os.getenv("GIGPILOT_MAKER_ENTRY", "1") == "1",
            maker_max_quote_age_ms=int(os.getenv("GIGPILOT_MAKER_MAX_QUOTE_AGE_MS", "2500")),
            maker_max_requotes=int(os.getenv("GIGPILOT_MAKER_MAX_REQUOTES", "2")),
            vpin_bucket_volume=_vpin_bucket_overrides(syms),
            max_signal_to_ack_drift_bps=float(os.getenv("GIGPILOT_MAX_SIGNAL_TO_ACK_DRIFT_BPS", "2.5")),
            min_arm_capital_usdt=float(os.getenv("GIGPILOT_MIN_ARM_CAPITAL_USDT", "67.0")),
            db_path=os.getenv("GIGPILOT_DB_PATH", "gigpilot.db"),
            log_level=os.getenv("GIGPILOT_LOG_LEVEL", "INFO"),
        )
