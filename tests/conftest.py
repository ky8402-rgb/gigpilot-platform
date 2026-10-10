"""Shared fixtures: a REAL GigPilot engine wired to a FAKE Bybit exchange.

Design notes that matter for the trustworthiness of these tests:

* The engine under test is the production `GigPilot` class, not a stand-in. Only the exchange
  boundary (`BybitREST`) is faked. That means the arm gate, risk gate, sizing, persistence and
  accounting logic exercised here is the same code that runs in production.
* The fake exchange is a deterministic double, used ONLY to drive control-flow decisions. It is not
  evidence of profitability, and it is never presented as such. Real edge must still come from live
  production evidence (see AI_EXECUTION_RULES.md rule 9).
* `AWS`/Bybit credentials are never real here; `Config.from_env` is bypassed by constructing
  `Config` directly so no environment secret is required or leaked.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


SYMBOLS = ["BTCUSDT", "ETHUSDT"]


class _SeededVpin:
    """Drop-in VPIN stand-in reporting covered, non-toxic flow without ingesting real buckets.

    A REAL `VpinEngine` needs `window_buckets` completed buckets before `vpin` is non-None, and feeding
    those buckets sets `_trades`/`_buckets` — which trips `VpinEngine.recalibrate`'s "legal only before
    ingestion" guard when `engine.start()` later calibrates ADV-derived bucket sizes. This stand-in
    keeps the quant admission gate satisfied while leaving boot-time recalibration legal.
    """

    def __init__(self, vpin: float = 0.2) -> None:
        self.vpin = vpin
        self._threshold = 0.8

    def recalibrate(self, volume: float) -> None:
        return None

    def effective_threshold(self) -> float:
        return self._threshold

    def snapshot(self) -> dict:
        return {
            "vpin": self.vpin,
            "threshold_p90": self._threshold,
            "effective_threshold": self._threshold,
            "buckets": 50,
            "window": 50,
            "trades": 100,
            "high_toxicity": self.vpin > self._threshold,
            "widen_ticks": 0,
            "pause": False,
        }


class FakeREST:
    """Deterministic stand-in for `gpkg.exchange.bybit_rest.BybitREST`.

    Every knob is a public attribute so a test can put the engine into a specific state (no capital,
    revoked trade permission, stale book) and assert what the engine does about it.
    """

    def __init__(self, symbols=None, equity: float = 500.0, trade_permission: bool = True,
                 taker_fee: float = 0.0001, bar_volume: float = 10.0):
        self.symbols = symbols or list(SYMBOLS)
        self.equity = equity
        self.trade_permission = trade_permission
        self.taker_fee = taker_fee
        # Base volume per synthetic kline bar; 288 bars of this make the 24h ADV the VPIN
        # calibration reads at boot.
        self.bar_volume = bar_volume
        # Used by `_sign`, mirroring `BybitREST`'s resolved secret.
        self.api_secret = "test-secret"
        self.read_only = 0
        self.position_legs: list[dict] = []
        self._leverage: dict[str, float] = {}
        self.placed_orders: list[dict] = []
        self.cancelled: list[dict] = []
        self.closed: list[dict] = []
        self.protections: list[dict] = []   # native TP/SL registrations (trading-stop)
        self.started = False
        # Post-only entry quotes that this fake fills immediately, keyed by the child orderLinkId.
        # A real book fills a passive order that is priced at the touch, and the engine now routes
        # entries that way, so the fake has to be able to complete one — otherwise the lifecycle
        # tests would only be able to observe a skip and would stop covering protect/close/accounting.
        self.maker_fills: dict[str, dict] = {}
        # Set to True to model a book that never trades against us (the quote goes stale instead).
        self.maker_never_fills = False
        # orderLinkIds already seen -> a resubmit is answered with the duplicate code, exactly as
        # Bybit does when a retry follows a lost response.
        self._seen_links: set[str] = set()

    async def start(self):
        self.started = True

    async def stop(self):
        self.started = False

    def _sign(self, ts: str, payload: str) -> str:
        """Mirror of `BybitREST._sign`, so the engine's credential-verification path is exercisable.

        `GigPilot.verify_credentials()` proves the HMAC path before trusting a credential, and that
        check is called at ARM time as well as boot. A fake without `_sign` would make the whole
        check fail on AttributeError in every test, which would look like a refused credential
        rather than a missing test method.
        """
        import hashlib
        import hmac

        return hmac.new(self.api_secret.encode(), (ts + payload).encode(),
                        hashlib.sha256).hexdigest()

    async def wallet(self):
        return {"list": [{
            "totalEquity": str(self.equity),
            "accountIMRate": "0.0",
            "coin": [{
                "coin": "USDT",
                "equity": str(self.equity),
                "walletBalance": str(self.equity),
                "availableToWithdraw": str(self.equity),
            }],
        }]}

    async def positions(self):
        return list(self.position_legs)

    async def open_orders(self):
        # A filled order is not open: it has left the realtime book, which is exactly the state that
        # makes `order_history` necessary to tell "filled" from "cancelled".
        return []

    async def order_history(self, symbol: str, order_link_id: str | None = None, limit: int = 50):
        """Finalised orders. Mirrors BybitREST.order_history so the maker lifecycle can resolve a
        terminal state instead of guessing — see `_MakerIO.state`."""
        out = [v for v in self.maker_fills.values() if v.get("symbol") == symbol]
        if order_link_id:
            out = [v for v in out if v.get("orderLinkId") == order_link_id]
        return out[: int(limit)]

    async def cancel_order(self, **kw):
        self.cancelled.append(kw)
        return {}

    async def api_info(self):
        # Match BybitREST.api_info(): _req() already unwraps the venue's top-level result envelope.
        return {
            "readOnly": self.read_only,
            "permissions": {"ContractTrade": ["Order", "Position"] if self.trade_permission else []},
        }

    async def instrument(self, symbol: str):
        return {
            "symbol": symbol,
            "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001", "maxOrderQty": "1000",
                              "minNotionalValue": "5"},
            "priceFilter": {"tickSize": "0.1"},
        }

    async def fee_rate(self, symbol: str):
        return {"takerFeeRate": str(self.taker_fee), "makerFeeRate": "0.0001"}

    async def tickers(self):
        """Bybit-shaped linear tickers (strings, as the venue sends them).

        `FuturesCommandCenter`'s universe is built from these, so without them the endpoint would be
        untestable and its shape could drift from the UI contract unnoticed — which is exactly how the
        legacy `{category, pairs}` payload shipped.
        """
        rows = []
        for i, s in enumerate(self.symbols):
            px = 100.0 + i * 10.0
            rows.append({
                "symbol": s, "lastPrice": str(px),
                "bid1Price": str(px - 0.01), "ask1Price": str(px + 0.01),
                "volume24h": str(1000.0 + i),
                "price24hPctChg": str(1.5 + i),
                "fundingRate": "0.0001",
            })
        # A non-configured USDT perp, to prove the venue is browsable while `eligible` stays honest.
        rows.append({"symbol": "DOGEUSDT", "lastPrice": "0.5", "bid1Price": "0.4999",
                     "ask1Price": "0.5001", "volume24h": "50", "price24hPctChg": "0.2",
                     "fundingRate": ""})
        # A non-USDT contract, which must be filtered out.
        rows.append({"symbol": "BTCUSD", "lastPrice": "60000", "volume24h": "9"})
        return rows

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200):
        """Bybit-shaped klines, NEWEST FIRST, with a real volume column.

        Index 4 is the close and index 5 is the base volume. The volume column is present because
        the VPIN bucket size is now derived from 24h ADV (`gpkg/strategy/vpin_calibration.py`), and a
        fake without volumes would make that whole path untestable — `adv_from_klines` would return
        None on every symbol and the code would silently only ever exercise the fallback.
        """
        rows = [[i * 300_000, "100", "100", "100", str(100.0 + i * 0.01), str(self.bar_volume)]
                for i in range(limit)]
        return list(reversed(rows))

    async def set_leverage(self, symbol: str, lev: float):
        """Record leverage AND expose it back on a flat leg, so the engine's read-back verification
        (set_leverage -> positions -> compare) has something real to confirm."""
        self._leverage[symbol] = float(lev)
        leg = next((p for p in self.position_legs if p.get("symbol") == symbol), None)
        if leg is None:
            self.position_legs.append({
                "symbol": symbol, "size": "0", "side": "", "avgPrice": "0",
                "markPrice": "100", "leverage": str(lev), "positionIdx": 0,
            })
        else:
            leg["leverage"] = str(lev)

    async def closed_pnl(self, limit: int = 100):
        return []

    async def cancel_all(self, symbol: str):
        self.cancelled.append({"symbol": symbol})
        return {}

    async def trading_stop(self, **kw):
        self.protections.append(kw)
        return {}

    async def place_order(self, **kw):
        from gpkg.core.errors import DUPLICATE_ORDER_LINK_CODE, BybitError

        link = kw.get("orderLinkId", "")
        if link and link in self._seen_links:
            raise BybitError(DUPLICATE_ORDER_LINK_CODE, "orderLinkId already exists")
        if link:
            self._seen_links.add(link)
        self.placed_orders.append(kw)
        # A post-only entry is filled by the book at its limit price, unless the test asks for a book
        # that never trades against us (which is what drives the stale-quote / requote path).
        if kw.get("timeInForce") == "PostOnly" and not self.maker_never_fills:
            self.maker_fills[link] = {
                "orderId": f"fake-{len(self.placed_orders)}",
                "orderLinkId": link,
                "symbol": kw.get("symbol", ""),
                "price": kw.get("price", "0"),
                "qty": kw.get("qty", "0"),
                "cumExecQty": kw.get("qty", "0"),
                "avgPrice": kw.get("price", "0"),
                "orderStatus": "Filled",
            }
        return {"orderId": f"fake-{len(self.placed_orders)}", "orderLinkId": link}


@pytest.fixture
def make_engine(tmp_path):
    """Factory: build a real GigPilot bound to a FakeREST, with a warm, freshly-stamped market."""

    # `fair_shift_bps` default is 20.0, not 10.0.
    #
    # These fixtures must clear the FULL corrected cost stack: round-trip fee (2x the per-side rate),
    # spread, slippage, funding, AND adverse selection. At 10.0 the synthetic edge was ~5.5 bps
    # against ~6 bps of true cost, so it only ever cleared because the fee was being charged once and
    # adverse selection was absent entirely — i.e. the fixture was calibrated against the very bug
    # that was fixed. Raising the modelled edge is the honest correction; lowering the hurdle or the
    # cost terms would have re-buried the defect.
    def _make(*, equity: float = 500.0, trade_permission: bool = True, taker_fee: float = 0.0001,
              armed_env: bool = False, warm: bool = True, hurdle_bps: float = 1.0,
              fair_shift_bps: float = 20.0, symbols=None,
              require_runtime_secret: bool = False, api_secret: str = "test-secret",
              bar_volume: float = 10.0):
        import gigpilot as gp
        from gpkg.core.config import Config

        syms = symbols or list(SYMBOLS)
        cfg = Config(
            api_key="test-key",
            api_secret=api_secret,
            symbols=syms,
            arm=armed_env,
            execution_mode="live",
            live_armed=True,
            edge_hurdle_bps=hurdle_bps,
            signal_fair_shift_bps=fair_shift_bps,
            # Runtime-secret mode is exercised by passing require_runtime_secret=True with
            # api_secret="" — the production cold-boot shape, where the absence of a secret is the
            # intended resting state rather than a fault.
            require_runtime_secret=require_runtime_secret,
            db_path=str(
                tmp_path / f"test-{abs(hash((equity, trade_permission, armed_env, require_runtime_secret)))}.db"),
        )
        engine: Any = gp.GigPilot(cfg)
        fake: FakeREST = FakeREST(symbols=syms, equity=equity, trade_permission=trade_permission,
                        taker_fee=taker_fee, bar_volume=bar_volume)
        fake.api_secret = api_secret or "test-secret"
        engine.rest = fake
        # Mirror production wiring: one transport behind one adapter shared by execution,
        # reconciliation and accounting. Replacing only engine.rest leaves those components
        # attached to the constructor's original live adapter and creates an impossible split-brain
        # test topology.
        from gpkg.exchange.adapters.bybit import BybitAdapter
        engine.exchange = BybitAdapter(cfg, rest=fake)
        engine.executor = gp.Executor(cfg, engine.exchange, {s: 0.001 for s in syms},
                                      min_sizes={s: 0.001 for s in syms})
        engine.reconciler.adapter = engine.exchange
        engine.reconciler.rest = fake
        engine.accounting.adapter = engine.exchange
        engine.accounting.rest = fake

        if warm:
            from gpkg.core.clock import now_ms
            now = now_ms()
            for s in syms:
                ms = engine.markets[s]
                # Tight spread, heavy bid imbalance -> a positive expected fair-value shift.
                ms.apply_book_snapshot([[99.99, 1_000_000.0]], [[100.01, 1.0]])
                ms.last = ms.mark = ms.index = 100.0
                ms.funding_rate = 0.0
                ms.ts_tick_ms = now
                ms.closes_1m.extend([100.0 + i * 0.01 for i in range(30)])
                # Seed VPIN coverage for the quant admission gate (OBI/VPIN/ATR) with a non-toxic,
                # non-None reading. A stand-in rather than real buckets: ingestion would make
                # `engine.start()`'s later ADV recalibration illegal (see `_SeededVpin`).
                engine.ws.vpin[s] = _SeededVpin()
            # FakeREST reports positions empty; leverage verification then reads 0 and blocks. Seed a
            # flat leg so the leverage check has something real to read back.
            fake.position_legs = []
            engine.ws._public_ok = True
            engine.ws._private_ok = True
            engine.fee_rate_bps = {s: taker_fee * 1e4 for s in syms}
            engine.step_size = {s: 0.001 for s in syms}
            engine.tick_size = {s: 0.1 for s in syms}
            engine.min_qty = {s: 0.001 for s in syms}

        return engine, fake

    return _make


@pytest.fixture
def authed_client(tmp_path, monkeypatch):
    """A TestClient for the real FastAPI app, with the engine replaced and owner auth isolated.

    Lifespan is deliberately NOT run: `TestClient(app)` outside a `with` block skips startup, so no
    live exchange connection is attempted.
    """
    from fastapi.testclient import TestClient

    import gigpilot as gp
    from gpkg.api import auth as auth_mod
    from gpkg.core.config import Config

    monkeypatch.setenv("GIGPILOT_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("OWNER_AUTH_PIN", "test-pin-123456")
    monkeypatch.delenv("JWT_SECRET", raising=False)
    monkeypatch.delenv("OWNER_SESSION_SECRET", raising=False)
    auth_mod._OWNER_AUTH = None

    engine = gp.GigPilot(Config(api_key="k", api_secret="s", symbols=["BTCUSDT"],
                                db_path=str(tmp_path / "cp.db")))
    monkeypatch.setattr(gp, "get_gp", lambda: engine)

    client = TestClient(gp.app, raise_server_exceptions=False)
    owner = auth_mod.get_owner_auth()
    token = owner.mint()
    return client, engine, token, owner
