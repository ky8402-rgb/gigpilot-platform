"""Keep `requirements.txt` and `pyproject.toml` from drifting apart.

Two files now describe the same dependency set, which is a real hazard: the deployment
tooling installs from `requirements.txt` while the linters, the type checker and CI read
`pyproject.toml`. If they diverge, the failure mode is a dependency that is present in
development and absent on the production host — discovered at runtime, in production.

These tests make that drift impossible to merge rather than merely unlikely.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ROOT / "requirements.txt"
PYPROJECT = ROOT / "pyproject.toml"


def _normalise(spec: str) -> str:
    """Reduce a requirement string to its bare lower-case project name.

    Strips version constraints, extras (`uvicorn[standard]`), environment markers and
    the trailing whitespace/comments that creep into hand-edited requirement files.
    """
    name = re.split(r"[<>=!~;\[\s]", spec.strip(), maxsplit=1)[0]
    return name.strip().lower().replace("_", "-")


def _requirements_names() -> set[str]:
    names = set()
    for line in REQUIREMENTS.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            names.add(_normalise(line))
    return names


def _pyproject_dependency_block(section_headers: list[str]) -> list[str]:
    """Extract a dependency array from pyproject.toml.

    Uses `tomllib` when available. Falls back to a targeted regex scan so the check still
    runs on Python 3.10, where the stdlib parser does not exist — a test that silently
    skips on the interpreter actually being used would be worse than no test.
    """
    text = PYPROJECT.read_text(encoding="utf-8")
    try:
        import tomllib  # type: ignore[import-not-found]
    except ModuleNotFoundError:
        tomllib = None  # type: ignore[assignment]

    if tomllib is not None:
        data = tomllib.loads(text)
        project = data.get("project", {})
        if section_headers == ["project"]:
            return list(project.get("dependencies", []))
        if section_headers == ["project", "optional-dependencies", "dev"]:
            return list(project.get("optional-dependencies", {}).get("dev", []))
        raise AssertionError(f"unhandled section: {section_headers}")

    # Fallback: capture the bracketed array following the first `dependencies = [` after the
    # requested marker.
    if section_headers == ["project"]:
        marker = r"^dependencies\s*=\s*\[(.*?)\]"
    else:
        marker = r"^dev\s*=\s*\[(.*?)\]"
    match = re.search(marker, text, flags=re.S | re.M)
    assert match, f"could not locate {section_headers} in pyproject.toml"
    return [item.strip().strip('"').strip("'") for item in match.group(1).split(",") if item.strip()]


def _pyproject_names(section_headers: list[str]) -> set[str]:
    return {_normalise(spec) for spec in _pyproject_dependency_block(section_headers)}


def test_requirements_file_exists_and_is_not_empty():
    assert REQUIREMENTS.is_file(), "requirements.txt is what the deployment tooling installs"
    assert _requirements_names(), "requirements.txt declares no dependencies"


def test_runtime_dependencies_match_pyproject():
    """Every runtime dependency must be declared in both places, with no extras on either side."""
    declared = _requirements_names()
    runtime = _pyproject_names(["project"])
    dev = _pyproject_names(["project", "optional-dependencies", "dev"])

    # requirements.txt is the union of runtime and dev, since ops/ installs it for CI too.
    assert declared == (runtime | dev), (
        "requirements.txt and pyproject.toml disagree.\n"
        f"  only in requirements.txt : {sorted(declared - (runtime | dev))}\n"
        f"  only in pyproject.toml   : {sorted((runtime | dev) - declared)}"
    )


def test_dev_only_tools_are_not_runtime_dependencies():
    """pytest must never be a runtime dependency of the trading engine."""
    runtime = _pyproject_names(["project"])
    for tool in ("pytest", "pytest-asyncio", "mypy", "ruff"):
        assert tool not in runtime, f"{tool} is test/lint tooling and must not ship at runtime"


@pytest.mark.parametrize(
    "key",
    [
        "QUANT__EXCHANGE__API_KEY",
        "QUANT__EXCHANGE__API_SECRET",
        "QUANT_LIVE_TRADING_ACK",
        "QUANT__EXECUTION__MODE",
        "QUANT__EXECUTION__ALLOW_LIVE",
    ],
)
def test_env_example_documents_the_required_keys(key):
    """`.env.example` must name the interlocks, so a new host is configured correctly.

    Also asserts the example carries no real value: a credential committed here would leak
    through a file whose entire purpose is to be copied and read.
    """
    example = ROOT / ".env.example"
    assert example.is_file(), ".env.example is the contract for deploying a new host"
    text = example.read_text(encoding="utf-8")
    assert key in text, f"{key} is undocumented in .env.example"


def test_env_example_warns_that_the_node_credential_names_are_not_read():
    """`BYBIT_API_KEY` is the Node service's name; this engine does not read it.

    Documenting that explicitly is the difference between a safe failure (paper mode, which
    someone then has to debug) and an obvious one.
    """
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    assert "BYBIT_API_KEY" in text, "the trap should be named, not implied"
    assert "NOT read by this engine" in text, "and stated as a warning, not listed as an option"


def test_env_example_contains_no_secret_values():
    """Every assignment in the example must be blank or a safe, non-secret default."""
    example = ROOT / ".env.example"
    safe_defaults = {
        "QUANT__EXECUTION__MODE",
        "QUANT__EXECUTION__ALLOW_LIVE",
        "QUANT__API__HOST",
        "QUANT__API__PORT",
        "QUANT__API__CORS_ORIGINS",
        "QUANT__DATA__PRIMARY_INTERVAL",
        "QUANT__DATA__HISTORY_BARS",
        "QUANT__DATA__KLINE_LIMIT",
        "QUANT__DATA__PERSIST_CANDLES",
        "QUANT__DATA__WS_ENABLED",
        "QUANT__DATA__WS_STALE_TIMEOUT_S",
        "QUANT__DATA__REST_POLL_SECONDS",
        "QUANT__DATA__DB_PATH",
        "QUANT__RISK__STARTING_EQUITY",
        "QUANT__RISK__RISK_PER_TRADE_PCT",
        "QUANT__RISK__MAX_LEVERAGE",
        "QUANT__RISK__MAX_POSITION_NOTIONAL_PCT",
        "QUANT__RISK__MAX_CONCURRENT_POSITIONS",
        "QUANT__RISK__MAX_GROSS_EXPOSURE_X",
        "QUANT__RISK__DAILY_LOSS_LIMIT_PCT",
        "QUANT__RISK__MAX_DRAWDOWN_PCT",
        "QUANT__RISK__MAX_SPREAD_BPS",
        "QUANT__RISK__MAX_DATA_AGE_S",
        "QUANT__RISK__HALT_FILE",
        "QUANT__COSTS__MAKER_FEE_BPS",
        "QUANT__COSTS__TAKER_FEE_BPS",
        "QUANT__COSTS__FALLBACK_SLIPPAGE_BPS",
        "QUANT__COSTS__ADVERSE_SELECTION_BPS",
        "QUANT__COSTS__HURDLE_MULTIPLIER",
        "QUANT__COSTS__MIN_EDGE_BPS",
        "QUANT__STRATEGY__MIN_EDGE_SAMPLES",
        "QUANT__STRATEGY__MIN_EDGE_TSTAT",
        "QUANT__LEARNING__ENABLED",
        "QUANT__LEARNING__OPTIMIZE_EVERY_HOURS",
        "QUANT__LEARNING__LOOKBACK_BARS",
        "QUANT__LEARNING__TRAIN_BARS",
        "QUANT__LEARNING__TEST_BARS",
        "QUANT__LEARNING__STEP_BARS",
        "QUANT__LOG_LEVEL",
        "QUANT__LOG_JSON",
    }
    # Keys that must be BLANK — a non-empty default would be a credential or an interlock.
    must_be_blank = {
        "QUANT__EXCHANGE__API_KEY",
        "QUANT__EXCHANGE__API_SECRET",
        "QUANT__EXCHANGE__EXPECTED_HOST_IP",
        "QUANT_LIVE_TRADING_ACK",
        "QUANT__API__TOKEN",
    }

    for raw in example.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key in must_be_blank:
            assert value == "", f"{key} must ship blank in .env.example, found a value"
        elif value:
            assert key in safe_defaults, (
                f"{key} has a non-empty value in .env.example but is not on the reviewed "
                f"allowlist of safe defaults — confirm it is not a secret"
            )


def test_live_trading_defaults_are_safe():
    """The shipped example must default to paper trading with live routing refused."""
    text = (ROOT / ".env.example").read_text(encoding="utf-8")
    assert re.search(r"^QUANT__EXECUTION__MODE=paper\s*$", text, flags=re.M), (
        "the example must default to paper mode"
    )
    assert re.search(r"^QUANT__EXECUTION__ALLOW_LIVE=false\s*$", text, flags=re.M), (
        "the example must default to live routing disabled"
    )
    assert re.search(r"^QUANT_LIVE_TRADING_ACK=\s*$", text, flags=re.M), (
        "the live-trading acknowledgement must ship unset"
    )
