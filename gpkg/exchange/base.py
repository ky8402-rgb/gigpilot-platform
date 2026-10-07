"""Unified exchange contract: the data model and the adapter interface.

WHY THIS FILE EXISTS
--------------------
Every exchange reports the same concepts in incompatible shapes. Bybit returns USDT equity nested
inside `list[0].coin[]`; Binance returns a flat `assets[]` with a separate `positions[]`; KuCoin
returns `accounts[]` filtered by currency. Quantities are decimal STRINGS on one venue and numbers on
another; some venues call a lot size `lotSize`, others `stepSize`; native take-profit is
`trading-stop` on one and `TAKE_PROFIT_MARKET` on another.

Multiplying that by four exchanges produces a combinatorial mess in the risk and execution layers,
and — more dangerously — it makes each venue's quirks a place where a safety check can be silently
skipped. So the strategy, risk and execution layers speak ONLY the types in this file, and each
adapter is responsible for translating into and out of its own wire format. All venue-specific
interpretation lives behind one seam, where it can be tested.

DESIGN RULES (each one earns its place)
---------------------------------------
1. FAIL CLOSED. `trade_permission()` is part of the contract, not optional, and adapters must
   DEFAULT TO DENIED. A key that authenticates is not a key that may trade — the live account
   proves this (reads work, order placement is refused). The registry refuses to route capital to
   an exchange whose permission has not been positively verified.

2. STRINGS FOR SIZES AND PRICES. Venues accept and return decimal strings because floats lose
   precision at exchange lot sizes. Keeping them as strings end-to-end means the value the engine
   computed is the value that goes on the wire, with no float round-trip in between.

3. IDEMPOTENCY IS PART OF THE INTERFACE. `OrderRequest.client_order_id` is required for entry
   orders. A retried request must be deduplicable by the venue, so a network timeout cannot become
   a double position.

4. NO FABRICATION. Every method returns either real venue data or raises `ExchangeError`. There is
   no default balance, no assumed position, no optimistic fill. If the venue did not say it, the
   engine does not know it.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum


# =====================================================================================
# Errors
# =====================================================================================
class ExchangeError(Exception):
    """Base for every venue-side failure. Adapters must never let a raw library error escape."""

    def __init__(self, exchange: str, message: str, code: str | None = None, retryable: bool = False):
        super().__init__(f"[{exchange}] {message}" + (f" (code={code})" if code else ""))
        self.exchange = exchange
        self.message = message
        self.code = code
        self.retryable = retryable


class CredentialsMissing(ExchangeError):
    """No usable credential for this exchange. Distinct from auth failure: there is nothing to try."""


class PermissionDenied(ExchangeError):
    """The credential authenticates but is not authorised for the requested action."""


class InstrumentUnknown(ExchangeError):
    """The venue does not list this symbol, or its spec could not be parsed.

    Refusing here is deliberate: trading an instrument whose lot size and tick size are unknown means
    guessing at the order size, which is how a "small" order becomes a large one.
    """


# =====================================================================================
# Enumerations
# =====================================================================================
class Side(str, Enum):
    BUY = "Buy"
    SELL = "Sell"


class OrderType(str, Enum):
    MARKET = "Market"
    LIMIT = "Limit"


class TimeInForce(str, Enum):
    """How long an order lives, and whether it may take liquidity.

    This exists because `timeInForce` was previously a hardcoded "GTC" literal buried in the Bybit
    adapter's LIMIT branch. That made it impossible for the routing layer to express "rest passively"
    — the single decision worth about 7 bps of edge per round trip (measured: taker fees 11.0 bps vs
    maker 4.0 bps round-trip on a live BTCUSDT quote) — without forking the adapter.

    POST_ONLY is the one that matters economically. Bybit rejects a post-only order that would have
    crossed the book instead of silently executing it as a taker, so it is also a SAFETY property:
    the venue enforces that we do not pay the spread by accident.
    """

    GTC = "GTC"            # rest until cancelled; may take liquidity if priced through the book
    POST_ONLY = "PostOnly"  # must rest as a maker; venue rejects rather than crossing
    IOC = "IOC"            # take what is available immediately, cancel the rest


class OrderStatus(str, Enum):
    OPEN = "open"
    FILLED = "filled"
    PARTIALLY_FILLED = "partially_filled"
    CANCELLED = "cancelled"
    REJECTED = "rejected"
    UNKNOWN = "unknown"


class MarginMode(str, Enum):
    CROSS = "cross"
    ISOLATED = "isolated"


# =====================================================================================
# Market data
# =====================================================================================
@dataclass(frozen=True)
class Instrument:
    """A tradeable contract, normalised across venues.

    `qty_step` / `min_qty` / `tick_size` are the fields the executor depends on. An adapter that
    cannot populate them must raise `InstrumentUnknown` rather than return a partial shape — the
    executor refuses unknown step sizes precisely because a wrong one mis-sizes every order.
    """

    exchange: str
    symbol: str            # venue-native symbol, e.g. "BTCUSDT"
    unified: str           # venue-independent form, e.g. "BTC/USDT"
    base: str
    quote: str
    qty_step: str
    min_qty: str
    tick_size: str
    max_leverage: float
    contract_type: str = "PERPETUAL"
    status: str = "TRADING"
    raw: dict = field(default_factory=dict, compare=False)

    # Venues name perpetuals inconsistently: Bybit "LinearPerpetual", Binance "PERPETUAL",
    # KuCoin "FFWCSX" (their perpetual contract type), plus common aliases.
    _PERPETUAL_TYPES = frozenset({"PERPETUAL", "LINEARPERPETUAL", "FFWCSX", "SWAP", "PERP"})

    def is_perpetual(self) -> bool:
        """True only for perpetual swaps.

        This exists because a venue can list a PERPETUAL and several DATED futures on the same
        underlying — Binance lists `BTCUSDT` alongside `BTCUSDT_261225` and `BTCUSDT_270326`. All
        three are "BTC/USDT" by base/quote, but a quarterly future has a delivery date, different
        liquidity and no perpetual funding. Treating them as the same market lets venue selection
        silently route a perpetual strategy into a dated contract.
        """
        return self.contract_type.upper() in self._PERPETUAL_TYPES

    def tradeable(self) -> bool:
        return (
            self.status.upper() in ("TRADING", "ONLINE", "OPEN")
            and self.is_perpetual()
            and float(self.qty_step) > 0
            and float(self.min_qty) > 0
            and float(self.tick_size) > 0
            and self.max_leverage >= 1.0
        )


@dataclass(frozen=True)
class Ticker:
    exchange: str
    symbol: str
    last: float
    bid: float
    ask: float
    funding_rate: float = 0.0
    next_funding_ms: int = 0

    @property
    def mid(self) -> float:
        return (self.bid + self.ask) / 2.0 if (self.bid > 0 and self.ask > 0) else self.last

    @property
    def spread_bps(self) -> float:
        m = self.mid
        if m <= 0 or self.bid <= 0 or self.ask <= 0:
            return float("inf")
        return (self.ask - self.bid) / m * 1e4


@dataclass(frozen=True)
class FeeRate:
    exchange: str
    symbol: str
    taker_bps: float
    maker_bps: float

    def round_trip_taker_bps(self) -> float:
        """Both legs. A completed trade pays the per-side rate on entry AND exit."""
        return self.taker_bps * 2.0


# =====================================================================================
# Account state
# =====================================================================================
@dataclass(frozen=True)
class Balance:
    exchange: str
    asset: str
    free: float
    used: float
    total: float
    raw: dict = field(default_factory=dict, compare=False)


@dataclass
class AccountSnapshot:
    """Everything the capital allocator needs to know about one exchange.

    `withdraw_enabled` is captured because withdrawal capability must NEVER be granted to a trading
    key. It is surfaced so the readiness layer can assert on it; an adapter that cannot determine it
    reports False and the exchange is treated as unusable for autonomous routing.
    """

    exchange: str
    equity_usd: float = 0.0
    available_usd: float = 0.0
    balances: list[Balance] = field(default_factory=list)
    margin_mode: MarginMode = MarginMode.CROSS
    read_ok: bool = False
    trade_permission_ok: bool = False
    withdraw_enabled: bool = False
    permission_error: str = ""
    ts_ms: int = 0

    def usable_for_autonomous(self) -> bool:
        """The single gate every autonomous path must consult. Denies by default."""
        return (
            self.read_ok
            and self.trade_permission_ok
            and not self.withdraw_enabled
            and self.equity_usd > 0
        )


@dataclass(frozen=True)
class Position:
    exchange: str
    symbol: str
    side: Side
    qty: float
    entry_price: float
    mark_price: float
    leverage: float
    unrealized_pnl: float = 0.0
    liquidation_price: float = 0.0
    position_idx: int = 0
    raw: dict = field(default_factory=dict, compare=False)

    @property
    def notional(self) -> float:
        return abs(self.qty) * (self.mark_price or self.entry_price)


# =====================================================================================
# Orders and fills
# =====================================================================================
@dataclass(frozen=True)
class OrderRequest:
    """A normalised order. `client_order_id` is REQUIRED for entries (idempotency, see rule 3)."""

    exchange: str
    symbol: str
    side: Side
    qty: str
    order_type: OrderType = OrderType.MARKET
    price: str | None = None
    reduce_only: bool = False
    client_order_id: str | None = None
    position_idx: int = 0
    # Defaults to GTC so every existing caller keeps today's behaviour. The ENTRY path sets this
    # explicitly from its routing decision; leaving it unset is what an un-routed order looks like.
    time_in_force: TimeInForce = TimeInForce.GTC
    # EXCHANGE-NATIVE PROTECTION. When set, these ride on the ENTRY order itself, so the venue
    # applies them the instant the order fills. That closes the window in which a position exists
    # unprotected: the previous design placed the entry, then made a SECOND call to attach TP/SL, and
    # a crash between the two left a naked leveraged position with no local daemon (and, in
    # runtime-secret mode, no credential) able to close it. `None` means "not attached here" — the
    # post-fill protection path still runs and remains authoritative.
    take_profit: str | None = None
    stop_loss: str | None = None

    def validate(self) -> None:
        if self.order_type is OrderType.MARKET and not self.reduce_only and not self.client_order_id:
            raise ValueError(
                "non-reduce-only orders require client_order_id: without it a retry after a timeout "
                "cannot be deduplicated by the venue and becomes a double position"
            )
        if float(self.qty) <= 0:
            raise ValueError(f"qty must be positive, got {self.qty!r}")
        if self.order_type is OrderType.LIMIT and not self.price:
            raise ValueError("LIMIT order requires a price")


@dataclass(frozen=True)
class OrderResult:
    exchange: str
    symbol: str
    order_id: str
    client_order_id: str | None
    status: OrderStatus
    filled_qty: float = 0.0
    avg_price: float = 0.0
    duplicate: bool = False   # venue reported this client_order_id already existed
    raw: dict = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Order:
    exchange: str
    symbol: str
    order_id: str
    client_order_id: str | None
    side: Side
    qty: float
    price: float
    status: OrderStatus
    reduce_only: bool = False
    raw: dict = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class Fill:
    """A closed trade as reported BY THE VENUE. This is the only acceptable PnL source."""

    exchange: str
    symbol: str
    order_id: str
    side: Side
    qty: float
    price: float
    closed_pnl: float
    fees: float
    funding: float = 0.0
    ts_ms: int = 0
    raw: dict = field(default_factory=dict, compare=False)

    @property
    def net_pnl(self) -> float:
        """Realized PnL after the costs the venue itself charged."""
        return self.closed_pnl - abs(self.fees) - abs(self.funding)


# =====================================================================================
# The adapter contract
# =====================================================================================
class ExchangeAdapter(ABC):
    """One venue, normalised.

    Implementations must raise `ExchangeError` (or a subclass) for every failure. They must not
    swallow errors, invent placeholder values, or return an empty list to mean "unknown" — an empty
    position list from a venue that failed to respond is indistinguishable from a flat account, and
    the reconciler would act on it.
    """

    name: str = "abstract"

    # -- lifecycle -------------------------------------------------------------------
    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def stop(self) -> None: ...

    # -- discovery -------------------------------------------------------------------
    @abstractmethod
    async def instruments(self) -> list[Instrument]:
        """Every listed perpetual. Used for cross-exchange market discovery."""

    @abstractmethod
    async def instrument(self, symbol: str) -> Instrument: ...

    @abstractmethod
    async def ticker(self, symbol: str) -> Ticker: ...

    @abstractmethod
    async def fee_rate(self, symbol: str) -> FeeRate: ...

    # -- account ---------------------------------------------------------------------
    @abstractmethod
    async def account(self) -> AccountSnapshot: ...

    @abstractmethod
    async def positions(self) -> list[Position]: ...

    @abstractmethod
    async def open_orders(self) -> list[Order]: ...

    @abstractmethod
    async def closed_pnl(self, limit: int = 100) -> list[Fill]: ...

    # -- permissions -----------------------------------------------------------------
    @abstractmethod
    async def trade_permission(self) -> tuple[bool, str]:
        """(authorised_to_trade, human_readable_reason). MUST default to (False, reason)."""

    # -- mutation --------------------------------------------------------------------
    @abstractmethod
    async def set_leverage(self, symbol: str, leverage: float) -> None: ...

    @abstractmethod
    async def place_order(self, req: OrderRequest) -> OrderResult: ...

    @abstractmethod
    async def cancel_order(self, symbol: str, order_id: str) -> None: ...

    @abstractmethod
    async def cancel_all(self, symbol: str) -> None: ...

    @abstractmethod
    async def set_protection(self, symbol: str, side: Side, qty: str,
                             take_profit: str | None, stop_loss: str | None) -> None:
        """Register NATIVE take-profit / stop-loss so protection survives this process dying."""

    def supports_native_protection(self) -> bool:
        return True

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return f"<{type(self).__name__} name={self.name!r}>"
