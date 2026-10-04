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

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


SYMBOLS = ["BTCUSDT", "ETHUSDT"]


class FakeREST:
    """Deterministic stand-in for `gpkg.exchange.bybit_rest.BybitREST`.

    Every knob is a public attribute so a test can put the engine into a specific state (no capital,
    revoked trade permission, stale book) and assert what the engine does about it.
    """

    def __init__(self, symbols=None, equity: float = 500.0, trade_permission: bool = True,
                 taker_fee: float = 0.0001):
        self.symbols = symbols or list(SYMBOLS)
        self.equity = equity
        self.trade_permission = trade_permission
        self.taker_fee = taker_fee
        self.read_only = 0
        self.position_legs: list[dict] = []
        self._leverage: dict[str, float] = {}
        self.placed_orders: list[dict] = []
        self.cancelled: list[dict] = []
        self.closed: list[dict] = []
        self.protections: list[dict] = []   # native TP/SL registrations (trading-stop)
        self.started = False
        # orderLinkIds already seen -> a resubmit is answered with the duplicate code, exactly as
        # Bybit does when a retry follows a lost response.
        self._seen_links: set[str] = set()

    async def start(self):
        self.started = True

    async def stop(self):
        self.started = False

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
        return []

    async def api_info(self):
        # Match BybitREST.api_info(): _req() already unwraps the venue's top-level result envelope.
        return {
            "readOnly": self.read_only,
            "permissions": {"ContractTrade": ["Order", "Position"] if self.trade_permission else []},
        }

    async def instrument(self, symbol: str):
        return {
            "symbol": symbol,
            "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001", "maxOrderQty": "1000"},
            "priceFilter": {"tickSize": "0.1"},
        }

    async def fee_rate(self, symbol: str):
        return {"takerFeeRate": str(self.taker_fee), "makerFeeRate": "0.0001"}

    async def kline(self, symbol: str, interval: str = "1", limit: int = 200):
        # ascending close prices; index 4 is the close
        return [[0, 0, 0, 0, str(100.0 + i * 0.01)] for i in range(limit)]

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

    async def cancel_order(self, **kw):
        self.cancelled.append(kw)
        return {}

    async def trading_stop(self, **kw):
        self.protections.append(kw)
        return {}

    async def place_order(self, **kw):
        from gpkg.core.errors import BybitError, DUPLICATE_ORDER_LINK_CODE

        link = kw.get("orderLinkId", "")
        if link and link in self._seen_links:
            raise BybitError(DUPLICATE_ORDER_LINK_CODE, "orderLinkId already exists")
        if link:
            self._seen_links.add(link)
        self.placed_orders.append(kw)
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
              fair_shift_bps: float = 20.0, symbols=None):
        import gigpilot as gp
        from gpkg.core.config import Config

        syms = symbols or list(SYMBOLS)
        cfg = Config(
            api_key="test-key",
            api_secret="test-secret",
            symbols=syms,
            arm=armed_env,
            edge_hurdle_bps=hurdle_bps,
            signal_fair_shift_bps=fair_shift_bps,
            db_path=str(tmp_path / f"test-{abs(hash((equity, trade_permission, armed_env)))}.db"),
        )
        engine = gp.GigPilot(cfg)
        fake = FakeREST(symbols=syms, equity=equity, trade_permission=trade_permission,
                        taker_fee=taker_fee)
        engine.rest = fake
        engine.executor = gp.Executor(cfg, fake, {s: 0.001 for s in syms},
                                      min_sizes={s: 0.001 for s in syms})
        engine.reconciler.rest = fake
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
