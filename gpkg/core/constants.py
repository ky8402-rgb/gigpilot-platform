"""Constants shared across layers. NO imports — this module must stay dependency-free.

It exists so that a threshold needed by the always-imported telemetry path does not drag a heavy
module in with it. `gpkg.ml.data` is where the L2 gate lives, but that module imports aiohttp, and
`gpkg/core/ops.py` is imported at application top level (and by CLI entry points that run under system
python, which has no aiohttp). Importing the constant from there would couple the daemon's telemetry
to the ML dependency stack for the sake of one integer.
"""
from __future__ import annotations

#: L2 order-book snapshots required PER SYMBOL before the ML training gate will admit a run. ONE
#: definition: the gate, the collector's ETA projection, the operator-facing progress indicator and
#: the tests all read this, so they cannot drift apart.
L2_REQUIRED = 10_000
