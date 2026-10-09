#!/usr/bin/env python3
"""L2 INGESTION INDICATOR — the operator-visible progress toward the ML gate.

The gate is applied PER SYMBOL (10,000 snapshots each). `l2_buffer.rows` is a TOTAL across symbols,
so it answers the wrong question: 9,000 rows spread over 3 symbols is 3,000 each — nowhere near the
gate — while the total alone looks nearly there. An operator pacing the ingestion phase on the total
would be misled by roughly a factor of the symbol count, so the indicator is built on the per-symbol
minimum, which is the number that actually decides when the phase completes.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from gpkg.core import ops
from gpkg.core.constants import L2_REQUIRED
from gpkg.core.ops import operational_snapshot
from gpkg.persistence.store import Store


def _snap(store) -> dict:
    """`operational_snapshot` memoises for 5s in a MODULE-LEVEL cache that is not keyed by store, so
    consecutive assertions would otherwise all read the first result. Reset it per call.
    """
    ops._CACHE = (0.0, {})
    return operational_snapshot(store, ":memory:")


def _seed(store: Store, symbol: str, kind: str, n: int, *, spacing_ms: int = 1000,
          start_ms: int = 1_000_000) -> None:
    # `start_ms` matters: rows are keyed by (symbol, kind, ts_ms), so a second seed at the default
    # start would OVERWRITE the first rather than adding to it.
    for i in range(n):
        store.ml_market_upsert(symbol, kind, start_ms + i * spacing_ms, {"i": i})


@pytest.fixture()
def store(tmp_path):
    return Store(str(tmp_path / "l2.db"))


def test_the_indicator_reports_progress_toward_the_per_symbol_gate(store):
    _seed(store, "BTCUSDT", "orderbook_l2", 250)
    _seed(store, "ETHUSDT", "orderbook_l2", 100)
    snap = _snap(store)
    depth = snap["l2_depth"]

    assert depth["required"] == L2_REQUIRED == 500
    assert depth["symbols"] == {"BTCUSDT": 250, "ETHUSDT": 100}
    # The MINIMUM, not the total: 350 rows total would read as progress, but ETHUSDT is what gates.
    assert depth["min_symbol"] == 100
    assert depth["ready"] is False


def test_the_total_is_not_used_as_the_headline(store):
    """The specific trap: two symbols with unequal depth. A total-based indicator would show 300/10000
    while the binding symbol sits at 100 — the same shown progress regardless of how the rows are
    distributed, which is precisely the wrong signal."""
    _seed(store, "BTCUSDT", "orderbook_l2", 200)
    _seed(store, "ETHUSDT", "orderbook_l2", 100)
    snap = _snap(store)
    assert snap["l2_depth"]["min_symbol"] == 100
    # 300 rows total, and per-symbol average of 150 — both would read as more progress than the
    # binding symbol (100) actually represents.
    assert snap["l2_buffer"]["rows"] == 300
    assert snap["l2_depth"]["min_symbol"] != snap["l2_buffer"]["rows"] // 2


def test_ready_only_when_EVERY_symbol_clears_the_gate(store):
    _seed(store, "BTCUSDT", "orderbook_l2", L2_REQUIRED)
    _seed(store, "ETHUSDT", "orderbook_l2", L2_REQUIRED - 1)
    snap = _snap(store)
    assert snap["l2_depth"]["ready"] is False, "one symbol short is not ready"

    _seed(store, "ETHUSDT", "orderbook_l2", 1, start_ms=50_000_000)
    snap = _snap(store)
    assert snap["l2_depth"]["ready"] is True


def test_an_empty_buffer_reports_zero_rather_than_ready(store):
    """An empty DB must not be mistaken for a satisfied gate — absence of evidence is not evidence."""
    snap = _snap(store)
    assert snap["l2_depth"]["min_symbol"] == 0
    assert snap["l2_depth"]["ready"] is False
    assert snap["l2_depth"]["symbols"] == {}


def test_the_threshold_has_one_definition():
    from gpkg.ml.data import L2_REQUIRED as from_ml
    assert from_ml is L2_REQUIRED, "the gate and the indicator must read the same object"


if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        def _new_store():
            import time
            return Store(str(Path(tmp) / f"l2_{time.time_ns()}.db"))
        test_the_indicator_reports_progress_toward_the_per_symbol_gate(_new_store())
        test_the_total_is_not_used_as_the_headline(_new_store())
        test_ready_only_when_EVERY_symbol_clears_the_gate(_new_store())
        test_an_empty_buffer_reports_zero_rather_than_ready(_new_store())
        test_the_threshold_has_one_definition()
    print("ALL L2 INGESTION INDICATOR TESTS PASSED.")
