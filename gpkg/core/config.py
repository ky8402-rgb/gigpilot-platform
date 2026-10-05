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
from dataclasses import dataclass

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
    api_secret: str
    symbols: list[str]
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
        _maybe_load_aws_secret()
        key, secret = _maybe_load_local_keys()
        if not key or not secret:
            print("FATAL: BYBIT_API_KEY / BYBIT_API_SECRET required.", file=sys.stderr)
            sys.exit(2)
        host = os.getenv("GIGPILOT_HOST", LIVE_HOST).strip()
        if any(x in host.lower() for x in FORBIDDEN) or host != LIVE_HOST:
            print(f"FATAL: host must be exactly {LIVE_HOST}.", file=sys.stderr)
            sys.exit(2)
        syms = [s.strip().upper() for s in os.getenv("GIGPILOT_SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT").split(",") if s.strip()]
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
            symbols=syms,
            arm=os.getenv("GIGPILOT_ARM", "0") == "1",
            execution_mode=os.getenv("GIGPILOT_EXECUTION_MODE", "paper").strip().lower(),
            live_armed=os.getenv("GIGPILOT_LIVE_ARMED", "0") == "1",
            edge_hurdle_bps=float(os.getenv("GIGPILOT_HURDLE_BPS", "3.0")),
            fee_round_trip_multiple=float(os.getenv("GIGPILOT_FEE_ROUND_TRIP_MULTIPLE", "2.0")),
            adverse_selection_factor=float(os.getenv("GIGPILOT_ADVERSE_SELECTION_FACTOR", "0.5")),
            max_leverage=float(os.getenv("GIGPILOT_MAX_LEV", "3.0")),
            max_daily_loss_pct=float(os.getenv("GIGPILOT_MAX_DAILY_LOSS", "2.0")),
            max_open_orders_per_market=int(os.getenv("GIGPILOT_MAX_OPEN_ORDERS_PER_MARKET", "3")),
            taker_min_net_edge_bps=float(os.getenv("GIGPILOT_TAKER_MIN_NET_EDGE_BPS", "12.0")),
            max_signal_to_ack_drift_bps=float(os.getenv("GIGPILOT_MAX_SIGNAL_TO_ACK_DRIFT_BPS", "2.5")),
            min_arm_capital_usdt=float(os.getenv("GIGPILOT_MIN_ARM_CAPITAL_USDT", "67.0")),
            db_path=os.getenv("GIGPILOT_DB_PATH", "gigpilot.db"),
            log_level=os.getenv("GIGPILOT_LOG_LEVEL", "INFO"),
        )
