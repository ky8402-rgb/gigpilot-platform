"""Cost model. If these are wrong the whole 'verified edge' discipline is theatre."""
import pytest

from app.costs import CostModel, CostEstimate, estimate_slippage_bps
from app.exchange import DepthSnapshot, Ticker


def book(mid=100.0, spread_bps=2.0, levels=40, qty=5.0):
    half = mid * spread_bps / 10_000.0 / 2
    bids = [[mid - half - i * mid * 0.0001, qty] for i in range(levels)]
    asks = [[mid + half + i * mid * 0.0001, qty] for i in range(levels)]
    return DepthSnapshot(symbol="TESTUSDT", bids=bids, asks=asks)


def ticker(mid=100.0, spread_bps=2.0, funding=0.0):
    half = mid * spread_bps / 10_000.0 / 2
    return Ticker(symbol="TESTUSDT", last=mid, bid=mid - half, ask=mid + half,
                  quote_volume_24h=1e9, price_change_pct_24h=0.0,
                  mark_price=mid, funding_rate=funding)


def test_ticker_spread_bps():
    t = ticker(mid=100.0, spread_bps=10.0)
    assert t.spread_bps == pytest.approx(10.0, rel=1e-6)


def test_slippage_zero_for_tiny_order_on_deep_book():
    d = book(spread_bps=2.0, levels=40, qty=100.0)
    # A $10 order into a book with $10k per level should barely move.
    assert estimate_slippage_bps(d, "BUY", 10.0) < 1.5


def test_slippage_increases_with_size():
    d = book(spread_bps=2.0, levels=40, qty=1.0)
    small = estimate_slippage_bps(d, "BUY", 50.0)
    big = estimate_slippage_bps(d, "BUY", 5_000.0)
    assert big > small


def test_slippage_sign_is_adverse_both_ways():
    """Buying consumes asks (above mid), selling consumes bids (below mid); both
    are reported as positive cost."""
    d = book(spread_bps=1.0, levels=40, qty=1.0)
    assert estimate_slippage_bps(d, "BUY", 2_000.0) > 0
    assert estimate_slippage_bps(d, "SELL", 2_000.0) > 0


def test_slippage_falls_back_without_book():
    assert estimate_slippage_bps(None, "BUY", 1000.0, fallback_bps=3.5) == 3.5


def test_round_trip_charges_both_legs(cfg):
    cm = CostModel(cfg)
    est = cm.round_trip(ticker=ticker(), depth=book(), notional_usd=1000.0,
                        expected_holding_hours=8.0, entry_side="BUY")
    assert est.entry_fee_bps == pytest.approx(cfg.costs.taker_fee_bps)
    assert est.exit_fee_bps == pytest.approx(cfg.costs.taker_fee_bps)
    assert est.spread_bps == pytest.approx(2.0, rel=1e-6)
    assert est.adverse_selection_bps == pytest.approx(cfg.costs.adverse_selection_bps)
    assert est.total_bps > est.entry_fee_bps + est.exit_fee_bps


def test_funding_cost_sign_long_pays_positive_rate(cfg):
    cm = CostModel(cfg)
    long_est = cm.round_trip(ticker=ticker(funding=0.0005), depth=book(),
                             notional_usd=1000, expected_holding_hours=24, entry_side="BUY")
    short_est = cm.round_trip(ticker=ticker(funding=0.0005), depth=book(),
                              notional_usd=1000, expected_holding_hours=24, entry_side="SELL")
    # With positive funding, a long pays more than a short over the same horizon.
    assert long_est.funding_bps > short_est.funding_bps
    # A short still carries a baseline charge, because funding flips signs.
    assert short_est.funding_bps > 0


def test_hurdle_is_multiple_of_cost(cfg):
    cm = CostModel(cfg)
    est = CostEstimate(entry_fee_bps=5, exit_fee_bps=5, spread_bps=2,
                       entry_slippage_bps=1, exit_slippage_bps=2,
                       adverse_selection_bps=1, funding_bps=1)
    assert est.total_bps == pytest.approx(17.0)
    assert cm.hurdle_bps(est) == pytest.approx(17.0 * cfg.costs.hurdle_multiplier)


def test_hurdle_floor_applies(cfg):
    cm = CostModel(cfg)
    cheap = CostEstimate(entry_fee_bps=0.1, exit_fee_bps=0.1)
    assert cm.hurdle_bps(cheap) >= cfg.costs.min_edge_bps


def test_clears_hurdle_rejects_marginal_edges(cfg):
    cm = CostModel(cfg)
    est = CostEstimate(entry_fee_bps=5, exit_fee_bps=5, spread_bps=2,
                       entry_slippage_bps=1, exit_slippage_bps=2,
                       adverse_selection_bps=1, funding_bps=1)  # 17 bps
    ok, _short, reason = cm.clears_hurdle(10.0, est)
    assert ok is False and "REJECT" in reason
    ok2, _s2, reason2 = cm.clears_hurdle(100.0, est)
    assert ok2 is True and "net" in reason2
