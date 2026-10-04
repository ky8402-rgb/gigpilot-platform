import pytest

from gpkg.core.watchdog import TaskWatchdog


def test_watchdog_disarms_before_bounded_restart_and_opens_circuit():
    events = []
    metrics = []
    wd = TaskWatchdog(
        disarm=lambda reason: events.append(("disarm", reason)),
        journal=lambda kind, symbol, payload: events.append((kind, payload)),
        metric_inc=lambda name, **labels: metrics.append((name, labels)),
        max_failures=2,
        window_s=60,
        restart_delay_s=1,
    )

    assert wd.failure("strategy", RuntimeError("boom")) is True
    assert wd.circuit_open is False
    assert events[0][0] == "disarm"

    assert wd.failure("strategy", RuntimeError("boom-again")) is False
    assert wd.circuit_open is True
    assert any(name == "gigpilot_watchdog_circuit_open_total" for name, _ in metrics)


def test_watchdog_rejects_invalid_configuration():
    with pytest.raises(ValueError):
        TaskWatchdog(disarm=lambda _: None, journal=lambda *_: None, metric_inc=lambda *_args, **_kw: None, max_failures=0)
