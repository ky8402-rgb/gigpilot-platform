import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Config, load_config  # noqa: E402


@pytest.fixture(scope="session")
def cfg() -> Config:
    return load_config()


@pytest.fixture
def synthetic_ohlcv() -> pd.DataFrame:
    """Deterministic synthetic OHLCV with a clear trend then a reversal.

    Used only for unit tests that must be reproducible; nothing here is presented
    as market data.
    """
    rng = np.random.default_rng(7)
    n = 800
    drift = np.concatenate([
        np.full(300, 0.0012),
        np.full(200, -0.0015),
        np.full(300, 0.0006),
    ])
    noise = rng.normal(0, 0.004, n)
    ret = drift + noise
    close = 30_000 * np.exp(np.cumsum(ret))
    high = close * (1 + np.abs(rng.normal(0, 0.002, n)))
    low = close * (1 - np.abs(rng.normal(0, 0.002, n)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    volume = np.abs(rng.normal(1200, 300, n))
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=idx,
    )
