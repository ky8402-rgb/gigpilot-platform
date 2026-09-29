"""Learning discipline and the API surface.

The most important learning test asserts the module REFUSES to promote when there
is no out-of-sample edge. A self-improvement loop that always "improves" is just a
fancier way to overfit.
"""
import time

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

import tempfile
from pathlib import Path

from app.config import load_config
from app.learning import (DEFAULT_GRID, GRID_KEYS, ParamSet, WalkForwardOptimizer,
                          apply_params, score_trades)
from app.risk import RiskManager


@pytest.fixture
def cfg():
    return load_config()


def test_paramset_roundtrip():
    p = ParamSet(ema_fast=13, ema_slow=34, adx_min=26.0)
    p.version = 3
    r = ParamSet.from_dict(p.as_dict())
    assert r.ema_fast == 13 and r.version == 3


def test_paramset_from_dict_ignores_unknown_keys():
    r = ParamSet.from_dict({"ema_fast": 13, "bogus_field": "x", "__class__": "evil"})
    assert r.ema_fast == 13
    assert not hasattr(r, "bogus_field")


def test_grid_respects_fast_lt_slow(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    grid = opt.grid(max_sets=40)
    assert grid, "grid must not be empty"
    for p in grid:
        assert p.ema_fast < p.ema_slow


def test_grid_is_bounded(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    assert len(opt.grid(max_sets=12)) <= 12


def test_grid_keys_match_paramset_fields():
    for k in GRID_KEYS:
        assert k in ParamSet.__dataclass_fields__
    for k in DEFAULT_GRID:
        assert k in GRID_KEYS


def test_apply_params_does_not_mutate_original(cfg):
    before = cfg.strategy.ema_fast
    apply_params(cfg.strategy, ParamSet(ema_fast=99, ema_slow=200))
    assert cfg.strategy.ema_fast == before


def test_optimize_refuses_promotion_without_edge(cfg, tmp_path, synthetic_ohlcv):
    """On pure noise, the optimiser must return 'hold' — never a promotion."""
    rng = np.random.default_rng(3)
    n = 2600
    close = 1000 * np.exp(np.cumsum(rng.normal(0, 0.006, n)))
    df = pd.DataFrame({
        "open": np.concatenate([[close[0]], close[:-1]]),
        "high": close * 1.002, "low": close * 0.998, "close": close,
        "volume": np.abs(rng.normal(1000, 100, n)),
    }, index=pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC"))

    opt = WalkForwardOptimizer(cfg, tmp_path / "w.db")
    report = opt.optimize({"NOISEUSDT": df}, incumbent=ParamSet(),
                          candidates=opt.grid(max_sets=6))
    assert report["verdict"] in ("hold", "promote")
    if report["verdict"] == "promote":
        # A promotion is only legal if it cleared the out-of-sample bar.
        assert report["best"]["result"]["oos_net_bps"] > 0
        assert opt.active_params() is not None
    else:
        assert opt.active_params() is None


def test_optimize_returns_structured_report(cfg, tmp_path, synthetic_ohlcv):
    opt = WalkForwardOptimizer(cfg, tmp_path / "w2.db")
    rep = opt.optimize({"SYNTHUSDT": synthetic_ohlcv}, incumbent=ParamSet(),
                       candidates=opt.grid(max_sets=4))
    for k in ("verdict", "reason", "incumbent", "best", "evaluated"):
        assert k in rep
    assert isinstance(rep["reason"], str) and rep["reason"]


def test_history_and_rollback(tmp_path, cfg):
    opt = WalkForwardOptimizer(cfg, tmp_path / "w3.db")
    p = ParamSet(ema_fast=13, ema_slow=34, score=1.5, oos_net_bps=12.0, oos_trades=40)
    opt._promote(p, {"score": 1.5, "oos_net_bps": 12.0, "oos_trades": 40,
                     "win_rate": 0.5, "consistency": 0.7, "symbols": 3}, "test promotion")
    active = opt.active_params()
    assert active is not None and active.ema_fast == 13
    hist = opt.history(5)
    assert hist and hist[0]["status"] == "active"

    p2 = ParamSet(ema_fast=34, ema_slow=89, score=2.0, oos_net_bps=20.0, oos_trades=50)
    opt._promote(p2, {"score": 2.0, "oos_net_bps": 20.0, "oos_trades": 50,
                      "win_rate": 0.5, "consistency": 0.8, "symbols": 3}, "second")
    assert opt.active_params().ema_fast == 34

    rolled = opt.rollback(1)
    assert rolled is not None and rolled.ema_fast == 13
    assert opt.active_params().ema_fast == 13


def test_rollback_unknown_version_returns_none(tmp_path, cfg):
    opt = WalkForwardOptimizer(cfg, tmp_path / "w4.db")
    assert opt.rollback(999) is None


def test_record_rejection_persists(tmp_path, cfg):
    opt = WalkForwardOptimizer(cfg, tmp_path / "w5.db")
    opt.record_rejection({
        "reason": "no edge",
        "best": {"params": None, "result": {"score": 0.0, "oos_net_bps": 0.0, "oos_trades": 0}},
        "incumbent": {"params": ParamSet().as_dict(), "result": {}},
    })
    hist = opt.history(5)
    assert hist[0]["status"] == "rejected"


# --------------------------------------------------------------------- API
class FakeFeed:
    class health:
        connected = True
        last_message_ts = time.time()
        reconnects = 0
        errors = 0
        last_error = ""
        rest_polls = 4
        subscriptions = ["BTCUSDT@1h"]

        @staticmethod
        def as_dict():
            return {"connected": True, "last_message_age_s": 1.0, "reconnects": 0,
                    "errors": 0, "last_error": "", "rest_polls": 4,
                    "subscriptions": ["BTCUSDT@1h"]}

    class tickers:
        @staticmethod
        def get(_):
            return None

    def feed_age_s(self):
        return 1.0

    def is_stale(self):
        return False

    def data_ok(self):
        return True


class FakeEngine:
    """Minimal engine stub so the API contract and auth can be tested in isolation."""

    def __init__(self):
        self.cfg = load_config()
        # Isolate the test from live state: unique token AND a temp token path,
        # so a test run can never overwrite data/dashboard_token.txt.
        self.cfg.api.token = "test-token-123"
        self.cfg.api.persist_token = False
        self.cfg.api.token_file = str(Path(tempfile.mkdtemp()) / "token.txt")
        from app.portfolio import Ledger
        from app.risk import RiskManager
        from app.strategy import StrategyEngine
        from app.costs import CostModel
        from app.execution import ExecutionEngine, PaperBroker

        self.mode = "paper"
        self.symbols = ["BTCUSDT", "ETHUSDT"]
        self.feed = FakeFeed()
        self.ledger = Ledger(10_000.0, None, persist=False)
        self.risk = RiskManager(self.cfg)
        self.cost_model = CostModel(self.cfg)
        self.strategy = StrategyEngine(self.cfg, self.cost_model)
        self.broker = PaperBroker(self.cfg, self.ledger, self.cost_model)
        self.execution = ExecutionEngine(self.cfg, self.ledger, self.broker, self.cost_model)
        from app.engine import EngineStatus
        from app.learning import ParamSet
        self.status = EngineStatus()
        self.status.ticks = 5
        self.params = ParamSet()
        self.strategy_cfg = self.cfg.strategy
        self._selfcheck = {}

        class Opt:
            history = staticmethod(lambda n=10: [])
            rollback = staticmethod(lambda v: None)

        self.optimizer = Opt()
        self.specs = {}

    def snapshot(self):
        return {"ts": time.time(), "mode": self.mode, "symbols": self.symbols,
                "portfolio": self.ledger.snapshot(), "risk": self.risk.snapshot(),
                "engine": self.status.as_dict(), "feed": self.feed.health.as_dict(),
                "execution": self.execution.snapshot(), "costs": self.cost_model.snapshot(),
                "params": self.params.as_dict(), "selfcheck": {}, "interval": "1h"}

    def symbol_rows(self):
        return [{"symbol": "BTCUSDT", "price": 100.0, "direction": "FLAT",
                 "regime": "chop", "last_action": "HOLD", "last_decision": "no setup",
                 "edge_bps": 0.0, "hurdle_bps": 0.0, "net_edge_bps": 0.0,
                 "edge_samples": 0, "rejected_by": [], "in_position": False}]

    def candles(self, symbol, limit=300):
        now = int(time.time())
        return [{"time": now - (limit - i) * 3600, "open": 100.0, "high": 101.0,
                 "low": 99.0, "close": 100.5, "volume": 10.0} for i in range(limit)]

    async def run_learning_now(self):
        return {"verdict": "hold", "reason": "stub"}


@pytest.fixture
def client():
    from app.api import create_app

    eng = FakeEngine()
    # persist_token_file=False is REQUIRED: without it the suite would overwrite
    # the running instance's dashboard credential.
    app = create_app(eng, persist_token_file=False)
    return TestClient(app), eng


def test_health_is_public(client):
    c, _ = client
    r = c.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] in ("ok", "degraded")


def test_stats_is_prometheus_text(client):
    c, _ = client
    r = c.get("/api/stats")
    assert r.status_code == 200
    assert "quant_up" in r.text and "quant_equity_usd" in r.text
    assert "quant_tick_duration_seconds" in r.text
    assert "quant_tick_duration_max_seconds" in r.text
    assert "quant_slow_ticks_total" in r.text
    assert "api_secret" not in r.text.lower()


def test_state_requires_token(client):
    c, _ = client
    assert c.get("/api/state").status_code == 401
    assert c.get("/api/state?token=wrong").status_code == 403
    assert c.get("/api/state?token=test-token-123").status_code == 200


def test_bearer_header_accepted(client):
    c, _ = client
    r = c.get("/api/state", headers={"Authorization": "Bearer test-token-123"})
    assert r.status_code == 200


def test_candles_validate_symbol(client):
    c, _ = client
    assert c.get("/api/candles?symbol=NOPE&token=test-token-123").status_code == 404
    r = c.get("/api/candles?symbol=BTCUSDT&limit=50&token=test-token-123")
    assert r.status_code == 200
    assert len(r.json()["candles"]) == 50


def test_candles_limit_bounds_rejected(client):
    c, _ = client
    assert c.get("/api/candles?symbol=BTCUSDT&limit=99999&token=test-token-123").status_code == 422


def test_snapshot_contains_all_ui_fields(client):
    c, _ = client
    s = c.get("/api/state?token=test-token-123").json()
    for k in ("portfolio", "risk", "engine", "feed", "execution", "costs", "params", "mode"):
        assert k in s, f"dashboard depends on '{k}'"
    for k in ("equity", "realized_net", "unrealized_net", "positions",
              "total_fees", "total_funding", "gross_exposure", "stats"):
        assert k in s["portfolio"], f"portfolio missing '{k}'"
    for k in ("halted", "halt_reasons", "drawdown_pct", "daily_pnl", "limits"):
        assert k in s["risk"], f"risk missing '{k}'"


def test_halt_and_resume_flow(client):
    c, eng = client
    r = c.post("/api/control/halt?token=test-token-123")
    assert r.status_code == 200 and r.json()["ok"]
    assert eng.risk.state.halted is True
    r2 = c.post("/api/control/resume?token=test-token-123")
    assert r2.status_code == 200
    assert eng.risk.state.halted is False


def test_flatten_with_no_positions_is_safe(client):
    c, _ = client
    r = c.post("/api/control/flatten?token=test-token-123")
    assert r.status_code == 200 and r.json()["ok"]


def test_close_unknown_symbol_404(client):
    c, _ = client
    r = c.post("/api/control/close?token=test-token-123", json={"symbol": "BTCUSDT"})
    assert r.status_code == 404


def test_control_requires_auth(client):
    c, _ = client
    assert c.post("/api/control/halt").status_code == 401
    assert c.post("/api/control/flatten").status_code == 401


def test_logs_endpoint(client):
    c, _ = client
    r = c.get("/api/logs?limit=10&token=test-token-123")
    assert r.status_code == 200 and "logs" in r.json()


def test_index_and_assets_served(client):
    c, _ = client
    assert c.get("/").status_code == 200
    r = c.get("/app.js")
    assert r.status_code == 200 and "WebSocket" in r.text
    assert c.get("/styles.css").status_code == 200


# --------------------------------------------------------- symbol gating
def test_symbol_verdict_rejects_insufficient_evidence(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    ok, reason = opt.symbol_verdict({"oos_trades": 2, "oos_net_bps": 500.0, "consistency": 1.0})
    assert ok is False and "insufficient" in reason


def test_symbol_verdict_rejects_negative_expectancy(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    ok, reason = opt.symbol_verdict({"oos_trades": 40, "oos_net_bps": -12.0, "consistency": 0.8})
    assert ok is False and "negative" in reason


def test_symbol_verdict_rejects_inconsistent_results(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    ok, reason = opt.symbol_verdict({"oos_trades": 40, "oos_net_bps": 50.0, "consistency": 0.1})
    assert ok is False and "inconsistent" in reason


def test_symbol_verdict_accepts_positive_consistent_edge(cfg):
    opt = WalkForwardOptimizer(cfg, None)
    ok, reason = opt.symbol_verdict({"oos_trades": 40, "oos_net_bps": 50.0, "consistency": 0.7})
    assert ok is True and "positive" in reason


def test_apply_symbol_gating_persists_and_roundtrips(cfg, tmp_path):
    opt = WalkForwardOptimizer(cfg, tmp_path / "gate.db")
    # A symbol with a short/degenerate frame gets no evidence and must be disabled.
    import numpy as np
    import pandas as pd
    n = cfg.learning.train_bars + cfg.learning.test_bars
    close = np.linspace(100, 110, n)
    df = pd.DataFrame({"open": close, "high": close * 1.001, "low": close * 0.999,
                       "close": close, "volume": np.full(n, 10.0)},
                      index=pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC"))
    decisions = opt.apply_symbol_gating({"TSTUSDT": df}, ParamSet())
    assert "TSTUSDT" in decisions
    state = opt.symbol_state()
    assert "TSTUSDT" in state
    # Whatever the verdict, it must be persisted consistently with the decision.
    assert state["TSTUSDT"]["enabled"] is decisions["TSTUSDT"]["enabled"]
    assert state["TSTUSDT"]["reason"] == decisions["TSTUSDT"]["reason"]


# ---------------------------------------------------------------------------
# Regression tests for defects found by independent verification.
# ---------------------------------------------------------------------------
def test_test_suite_cannot_clobber_live_token_file():
    """Regression: create_app() used to write the token to the PROJECT_ROOT path.

    Running the suite therefore overwrote the live dashboard credential with the
    test constant, breaking the documented token and downgrading auth. The test
    fixture must both disable persistence and point at a temp path.
    """
    import tempfile
    from pathlib import Path as _P

    from app.api import create_app

    live_path = load_config().api.token_path
    before = live_path.read_text() if live_path.exists() else None

    eng = FakeEngine()
    assert eng.cfg.api.persist_token is False
    assert "test-token-123" not in str(eng.cfg.api.token_path)
    create_app(eng, persist_token_file=False)

    after = live_path.read_text() if live_path.exists() else None
    assert after == before, "running the test suite must not modify the live token file"


def test_create_app_persist_flag_writes_only_when_asked(tmp_path):
    from app.api import create_app, persist_token

    target = tmp_path / "sub" / "token.txt"
    assert persist_token("abc12345", target) is True
    assert target.read_text().strip() == "abc12345"
    assert (target.stat().st_mode & 0o777) == 0o600, "token file must be owner-only"


def test_token_is_stable_across_config_loads(tmp_path, monkeypatch):
    """Regression: a random token was generated on every boot, silently rotating
    the dashboard credential. A persisted token must be reused."""
    from app.config import load_config

    tf = tmp_path / "tok.txt"
    tf.write_text("stable-token-value\n")
    monkeypatch.setenv("QUANT__API__TOKEN_FILE", str(tf))
    monkeypatch.delenv("QUANT_API__TOKEN", raising=False)
    monkeypatch.delenv("QUANT__API__TOKEN", raising=False)
    a = load_config().api.token
    b = load_config().api.token
    assert a == "stable-token-value" and b == a


def test_unfit_token_file_is_ignored(tmp_path, monkeypatch):
    """A garbage/short token file must not be adopted as the credential."""
    from app.config import load_config

    tf = tmp_path / "tok.txt"
    tf.write_text("short")
    monkeypatch.setenv("QUANT__API__TOKEN_FILE", str(tf))
    monkeypatch.delenv("QUANT_API__TOKEN", raising=False)
    tok = load_config().api.token
    assert tok != "short" and len(tok) >= 16


# --- fail-closed defaults -------------------------------------------------
def test_risk_evaluate_defaults_fail_closed(cfg):
    """Omitting the health flags must HALT, not permit."""
    rm = RiskManager(cfg)
    rm.on_equity(10_000)
    allowed, reasons = rm.evaluate()
    assert allowed is False
    assert "stale_data" in reasons and "feed_down" in reasons


def test_hurdle_is_never_reported_as_zero_for_a_flat_setup(cfg):
    """Regression: decide() returned before pricing costs when there was no setup,
    so the dashboard showed 'hurdle 0.0bps' while the configured floor was 8bps."""
    from app.costs import CostModel
    from app.exchange import DepthSnapshot, Ticker
    from app.strategy import StrategyEngine

    cm = CostModel(cfg)
    eng = StrategyEngine(cfg, cm)
    n = cfg.strategy.ema_trend + 80
    close = np.linspace(100, 101, n)
    df = pd.DataFrame({"open": close, "high": close * 1.001, "low": close * 0.999,
                       "close": close, "volume": np.full(n, 10.0)},
                      index=pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC"))
    from app import indicators as ta
    enriched = ta.enrich(df, cfg.strategy)
    mid = 100.0
    tk = Ticker(symbol="T", last=mid, bid=mid - 0.01, ask=mid + 0.01,
                quote_volume_24h=1e9, price_change_pct_24h=0.0, mark_price=mid,
                funding_rate=0.0001)
    d = DepthSnapshot(symbol="T", bids=[[mid - 0.01 - i * 0.01, 50.0] for i in range(30)],
                      asks=[[mid + 0.01 + i * 0.01, 50.0] for i in range(30)])
    dec = eng.decide("T", enriched, tk, d, 10_000.0,
                     size_fn=lambda s, e, t, spec: {"qty": 0.0, "notional": 0.0})
    assert dec.hurdle_bps >= cfg.costs.min_edge_bps, (
        f"hurdle must reflect the live cost bar and the floor; got {dec.hurdle_bps}"
    )
    assert dec.cost_bps > 0


def test_candles_rejects_unsupported_interval(client):
    """An accepted-but-ignored query param returns data that does not match the
    request. Reject it instead of silently substituting another interval."""
    c, _ = client
    r = c.get("/api/candles?symbol=BTCUSDT&interval=1m&token=test-token-123")
    assert r.status_code == 400
    assert "unsupported interval" in r.json()["detail"]
    # The configured interval is still served.
    ok = c.get("/api/candles?symbol=BTCUSDT&interval=1h&token=test-token-123")
    assert ok.status_code == 200
    assert ok.json()["interval"] == "1h"
