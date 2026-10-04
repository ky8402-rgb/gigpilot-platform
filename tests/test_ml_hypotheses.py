from gpkg.ml.data import align_point_in_time
from gpkg.ml.hypotheses import evaluate_hypotheses
from gpkg.persistence.store import Store


def test_point_in_time_alignment_never_uses_future_book():
    bars = [{"ts_ms": 1000, "close": 100.0}, {"ts_ms": 2000, "close": 101.0}]
    books = [{"ts_ms": 1500, "bid": 99.0, "ask": 101.0}, {"ts_ms": 2500, "bid": 100.0, "ask": 102.0}]
    aligned = align_point_in_time(bars, books)
    assert [row["book"]["ts_ms"] for row in aligned] == [1500, 1500]


def test_hypothesis_training_reports_l2_warming_progress(tmp_path):
    store = Store(str(tmp_path / "ml.db"))
    for i in range(100):
        ts = 1_000_000 + i * 60_000
        store.ml_market_upsert("BTCUSDT", "kline_1m", ts, {
            "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.0 + (i % 3), "volume": 1.0
        })
        store.ml_market_upsert("BTCUSDT", "funding_8h", ts, {"funding_bps": 1.0})
        store.ml_market_upsert("BTCUSDT", "basis_1m", ts, {"basis_bps": 0.5})
    evidence, progress = evaluate_hypotheses(store, "BTCUSDT", end_ms=1_000_000 + 100 * 60_000)
    assert evidence == []
    assert progress["l2_ready_48h"] is False
    assert "/48 hours" in progress["message"]
    audit = store.ml_research_audits(limit=1)[0]
    assert audit["outcome"] == "WARMING"
