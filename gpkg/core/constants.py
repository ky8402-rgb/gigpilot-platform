"""Constants shared across layers. NO imports — this module must stay dependency-free.

It exists so that a threshold needed by the always-imported telemetry path does not drag a heavy
module in with it. `gpkg.ml.data` is where the L2 gate lives, but that module imports aiohttp, and
`gpkg/core/ops.py` is imported at application top level (and by CLI entry points that run under system
python, which has no aiohttp). Importing the constant from there would couple the daemon's telemetry
to the ML dependency stack for the sake of one integer.
"""
from __future__ import annotations

#: Active Trading Universe for micro-capital routing (<= 5 USDT balance).
#: BTCUSDT and ETHUSDT are removed because their minimum notional order sizes
#: structurally exceed or consume the available balance.
TRADING_UNIVERSE: tuple[str, ...] = ("1000PEPEUSDT", "1000BONKUSDT", "DOGEUSDT")

#: L2 order-book snapshots required PER SYMBOL before the ML training gate will admit a run. ONE
#: definition: the gate, the collector's ETA projection, the operator-facing progress indicator and
#: the tests all read this, so they cannot drift apart.
#: Reduced from 10_000 to 500 for the micro-cap bootstrap qualification gate so live trading can
#: commence in minutes at the 1-2s snapshot cadence.
L2_REQUIRED = 500

