"""Configuration: single source of truth.

Layering (later wins):
    1. dataclass defaults
    2. config/config.yaml
    3. environment variables  (QUANT__SECTION__FIELD=value)

Secrets are only ever sourced from the environment, never from YAML, so that
config.yaml can be committed and shared without leaking credentials.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import BaseModel, Field

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config" / "config.yaml"
ENV_PREFIX = "QUANT__"


def _env_overrides() -> Dict[str, Any]:
    """Parse QUANT__A__B__C=value into {'a': {'b': {'c': value}}}."""
    out: Dict[str, Any] = {}
    for raw_key, raw_val in os.environ.items():
        if not raw_key.startswith(ENV_PREFIX):
            continue
        parts = [p.lower() for p in raw_key[len(ENV_PREFIX):].split("__") if p]
        if not parts:
            continue
        node = out
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = _coerce(raw_val)
    return out


def _coerce(value: str) -> Any:
    v = value.strip()
    if v == "":
        return ""
    low = v.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if low in ("null", "none", "~"):
        return None
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    if v.startswith("[") or v.startswith("{"):
        try:
            import json

            return json.loads(v)
        except Exception:
            pass
    return v


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v
    return base


class ExchangeCfg(BaseModel):
    """Venue selection. `name` picks the adapter; URLs and fee presets follow from
    it unless explicitly overridden. Only USD-margined perpetual futures are
    supported on either venue."""
    name: str = "bybit"
    market_type: str = "linear"
    rest_url: str = "https://api.bybit.com"
    ws_url: str = "wss://stream.bybit.com/v5/public/linear"
    testnet: bool = False
    api_key: str = ""
    api_secret: str = ""
    recv_window_ms: int = 5000
    request_timeout_s: float = 10.0
    # Optional host-identity guard. If set, the platform refuses to trade unless
    # this host's outbound IP matches — which is the IP an exchange API key must
    # allowlist. Leave empty to disable. See app/hostid.py.
    expected_host_ip: str = ""
    max_retries: int = 4
    # Order-book levels sampled when estimating real slippage.
    depth_levels: int = 50


class UniverseCfg(BaseModel):
    """Symbol selection. Liquidity floors keep us away from untradeable books."""
    symbols: List[str] = Field(default_factory=list)   # explicit override; empty = auto-screen
    quote: str = "USDT"
    min_24h_quote_volume: float = 200_000_000.0
    max_symbols: int = 10
    exclude_bases: List[str] = Field(
        default_factory=lambda: ["USDC", "FDUSD", "TUSD", "BUSD", "DAI", "BTCDOM", "DEFI"]
    )
    refresh_minutes: int = 30


class CostsCfg(BaseModel):
    """Explicit cost model. Every number here is subtracted from gross edge."""
    # Bybit USDT-perp standard: maker 0.0200%, taker 0.0550%.
    # (Binance USDⓈ-M standard is maker 0.0200%, taker 0.0500% — switch these when
    # changing venue; `--check` prints the effective values.)
    maker_fee_bps: float = 2.0
    taker_fee_bps: float = 5.5
    fallback_slippage_bps: float = 2.0   # used when order book is unavailable
    adverse_selection_bps: float = 1.0   # market-order information leakage
    assume_taker_entry: bool = True
    assume_taker_exit_on_stop: bool = True
    # Strategy must clear this multiple of the modelled round-trip cost.
    hurdle_multiplier: float = 2.0
    # Absolute floor so we never trade sub-noise edges.
    min_edge_bps: float = 8.0
    # Funding is paid every 8h; we charge the worst-case of the expected holding window.
    funding_intervals_per_day: int = 3


class RiskCfg(BaseModel):
    starting_equity: float = 10_000.0
    risk_per_trade_pct: float = 0.5        # equity risked to the initial stop
    max_leverage: float = 5.0
    max_position_notional_pct: float = 25.0
    max_concurrent_positions: int = 3
    max_gross_exposure_x: float = 1.0      # total notional / equity
    max_symbol_exposure_pct: float = 25.0
    daily_loss_limit_pct: float = 3.0      # halt for the rest of the UTC day
    max_drawdown_pct: float = 12.0         # kill switch, requires manual reset
    max_consecutive_losses: int = 5
    max_spread_bps: float = 4.0            # skip entries when the book is too wide
    min_expected_holding_bars: int = 3
    # If this file exists, trading is halted. `touch data/HALT` stops new risk
    # without API access; removing it resumes (only this reason is cleared).
    halt_file: str = "data/HALT"
    # Guard against a position being opened on stale data.
    max_data_age_s: float = 180.0


class StrategyCfg(BaseModel):
    """Signal rules AND trade geometry.

    Geometry lives here (not in RiskCfg) because it is part of the strategy the
    optimiser is allowed to search. RiskCfg holds only hard limits that the search
    must never be able to widen.
    """
    ema_fast: int = 21
    ema_slow: int = 55
    ema_trend: int = 200
    adx_period: int = 14
    adx_min: float = 20.0
    donchian_period: int = 20
    atr_period: int = 14
    roc_period: int = 10
    rsi_period: int = 14
    bb_period: int = 20
    bb_k: float = 2.0
    # Breakout buffer in ATR to avoid trading inside the noise band.
    breakout_buffer_atr: float = 0.15
    # Minimum |z-score| of price vs mean to consider momentum real.
    min_momentum_atr: float = 0.25
    require_htf_alignment: bool = True
    htf_multiple: int = 4
    # Minimum evidence before a setup is credited with an edge at all.
    min_edge_samples: int = 10
    min_edge_tstat: float = 1.0
    # --- trade geometry (optimiser-searchable) --------------------------
    atr_stop_mult: float = 2.0
    tp_r_multiple: float = 2.5
    breakeven_after_r: float = 1.0
    trailing_start_r: float = 1.0
    trailing_atr_mult: float = 1.5


class ExecutionCfg(BaseModel):
    mode: str = "paper"                    # "paper" | "live"
    order_type: str = "market"             # entry routing
    maker_timeout_s: int = 20
    limit_offset_bps: float = 1.0
    # Global hard interlock for real order routing.
    allow_live: bool = False
    max_orders_per_day: int = 200
    # Reject if the exchange rejects more than this many orders in a row.
    max_consecutive_rejects: int = 5


class DataCfg(BaseModel):
    primary_interval: str = "1h"
    kline_limit: int = 1000
    # Bars of real history fetched per symbol for warm-up and backtests.
    history_bars: int = 10000
    persist_candles: bool = True
    ws_enabled: bool = True
    ws_stale_timeout_s: float = 90.0
    rest_poll_seconds: float = 30.0
    db_path: str = "data/db/quant.db"


class ApiCfg(BaseModel):
    host: str = "0.0.0.0"
    port: int = 8080
    token: str = ""
    # Where the dashboard token is persisted. Tests must point this at a temp
    # path (or disable persistence) so they can never clobber the live token.
    token_file: str = "data/dashboard_token.txt"
    persist_token: bool = True
    rate_limit_per_min: int = 600
    cors_origins: List[str] = Field(default_factory=lambda: ["*"])

    @property
    def token_path(self) -> Path:
        p = Path(self.token_file)
        return p if p.is_absolute() else PROJECT_ROOT / p


class LearningCfg(BaseModel):
    enabled: bool = True
    optimize_every_hours: float = 24.0
    lookback_bars: int = 4000
    train_bars: int = 1200
    test_bars: int = 400
    step_bars: int = 300
    min_trades_per_fold: int = 5
    # A promoted parameter set must beat the incumbent out-of-sample by this margin.
    promotion_margin: float = 0.10
    max_param_sets: int = 24


class HealthCfg(BaseModel):
    heartbeat_seconds: float = 10.0
    stale_feed_halt_s: float = 300.0
    reconcile_seconds: float = 60.0
    # Auto-rollback: revert to last known-good params if live net PnL degrades this much.
    auto_rollback_drawdown_pct: float = 6.0


class Config(BaseModel):
    exchange: ExchangeCfg = Field(default_factory=ExchangeCfg)
    universe: UniverseCfg = Field(default_factory=UniverseCfg)
    costs: CostsCfg = Field(default_factory=CostsCfg)
    risk: RiskCfg = Field(default_factory=RiskCfg)
    strategy: StrategyCfg = Field(default_factory=StrategyCfg)
    execution: ExecutionCfg = Field(default_factory=ExecutionCfg)
    data: DataCfg = Field(default_factory=DataCfg)
    api: ApiCfg = Field(default_factory=ApiCfg)
    learning: LearningCfg = Field(default_factory=LearningCfg)
    health: HealthCfg = Field(default_factory=HealthCfg)
    log_level: str = "INFO"
    log_json: bool = True

    # ---- derived ---------------------------------------------------------
    @property
    def db_file(self) -> Path:
        p = Path(self.data.db_path)
        return p if p.is_absolute() else PROJECT_ROOT / p

    def live_enabled(self) -> bool:
        """Live routing requires three independent signals to agree."""
        ack = os.environ.get("QUANT_LIVE_TRADING_ACK", "").strip().lower() == "yes"
        return bool(
            self.execution.mode == "live"
            and self.execution.allow_live
            and self.exchange.api_key
            and self.exchange.api_secret
            and ack
        )

    def effective_mode(self) -> str:
        return "live" if self.live_enabled() else "paper"


def load_dotenv(path: Optional[Path] = None) -> Dict[str, str]:
    """Load KEY=VALUE pairs from .env into the process environment.

    Real environment variables always win, so a container/supervisor-provided value
    is never overridden by the file. Values are never logged.
    """
    env_path = Path(path) if path else Path(os.environ.get("QUANT_ENV_FILE") or (PROJECT_ROOT / ".env"))
    loaded: Dict[str, str] = {}
    try:
        if not env_path.exists():
            return loaded
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            key, val = key.strip(), val.strip().strip('"').strip("'")
            if not key:
                continue
            loaded[key] = val
            if key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass
    return loaded


def load_config(path: Optional[Path] = None) -> Config:
    cfg_path = Path(path) if path else CONFIG_PATH
    load_dotenv()
    raw: Dict[str, Any] = {}
    if cfg_path.exists():
        loaded = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        if not isinstance(loaded, dict):
            raise ValueError(f"{cfg_path} must contain a YAML mapping")
        raw = loaded
    # Environment overrides win over YAML.
    _deep_merge(raw, _env_overrides())

    # Credentials are env-only unless explicitly placed in YAML by the operator.
    cfg = Config.model_validate(raw)

    env_key = os.environ.get("QUANT_EXCHANGE__API_KEY")
    env_secret = os.environ.get("QUANT_EXCHANGE__API_SECRET")
    if env_key:
        cfg.exchange.api_key = env_key.strip()
    if env_secret:
        cfg.exchange.api_secret = env_secret.strip()

    # Token resolution order: explicit env -> previously persisted file -> new random.
    # Reusing the persisted token keeps the dashboard credential STABLE across
    # restarts instead of silently rotating it every boot.
    if not cfg.api.token:
        env_token = os.environ.get("QUANT_API__TOKEN", "").strip()
        if env_token:
            cfg.api.token = env_token
        else:
            existing = _read_token_file(cfg.api.token_path)
            cfg.api.token = existing or _derive_token()
    return cfg


def _read_token_file(path: Path) -> str:
    try:
        if path.exists():
            tok = path.read_text(encoding="utf-8").strip()
            # Ignore obviously unfit values rather than trusting arbitrary content.
            if 8 <= len(tok) <= 256 and " " not in tok:
                return tok
    except OSError:
        pass
    return ""


def _derive_token() -> str:
    import hashlib
    import secrets

    seed = f"{secrets.token_hex(16)}|{Path.home()}"
    return hashlib.sha256(seed.encode()).hexdigest()[:32]


def redact(secret: str) -> str:
    """Never log a full credential."""
    if not secret:
        return "<unset>"
    if len(secret) <= 8:
        return "*" * len(secret)
    return f"{secret[:4]}…{secret[-4:]} ({len(secret)} chars)"


CONFIG: Optional[Config] = None


def get_config() -> Config:
    global CONFIG
    if CONFIG is None:
        CONFIG = load_config()
    return CONFIG
