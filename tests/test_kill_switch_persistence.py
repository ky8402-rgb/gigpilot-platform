#!/usr/bin/env python3
"""KILL SWITCH AND DISARM MUST SURVIVE A RESTART.

Regression origin
-----------------
`GigPilot.start()` did `self.armed = bool(self.cfg.arm)` unconditionally. The kill switch and the
disarm endpoint only cleared the IN-MEMORY flag and journalled the event; nothing was persisted. So
with `GIGPILOT_ARM=1` in the environment — the normal way to run this engine — a crash, a pm2
restart, or a deploy would bring the engine back ARMED, silently undoing an operator's emergency
stop. That is a fail-OPEN default, the one property a kill switch may never have.

Run: python3 tests/test_kill_switch_persistence.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _boot(tmp_path, *, armed_env: bool, db_path=None):
    """Construct a fresh engine on a given DB path — a stand-in for a process restart.

    Reusing the SAME db file is what makes this a restart test rather than a fresh-install test.
    """
    import gigpilot as gp
    from gpkg.core.config import Config

    cfg = Config(api_key="k", api_secret="s", symbols=["BTCUSDT"], arm=armed_env,
                 db_path=str(db_path or (tmp_path / "restart.db")))
    return gp.GigPilot(cfg)


def test_kill_switch_survives_restart_with_env_arm(tmp_path):
    engine = _boot(tmp_path, armed_env=True)
    assert engine._restore_arm_state() == (True, "env_GIGPILOT_ARM"), "env ARM should arm a clean boot"

    engine.kill()
    assert engine.armed is False
    assert engine.store.kv_get("arm_state") == "killed"
    engine.store._conn.close()

    # Restart with GIGPILOT_ARM=1 still set. The kill must win.
    rebooted = _boot(tmp_path, armed_env=True)
    armed, source = rebooted._restore_arm_state()
    assert armed is False, "engine re-armed after a kill — kill switch is not fail-closed"
    assert source == "persisted_kill_switch"
    rebooted.store._conn.close()


def test_disarm_survives_restart_with_env_arm(tmp_path):
    engine = _boot(tmp_path, armed_env=True)
    engine.disarm("manual")
    assert engine.store.kv_get("arm_state") == "disarmed"
    engine.store._conn.close()

    rebooted = _boot(tmp_path, armed_env=True)
    armed, source = rebooted._restore_arm_state()
    assert armed is False, "engine re-armed after an explicit disarm"
    assert source == "persisted_disarm"
    rebooted.store._conn.close()


async def test_auto_disarm_is_also_persisted(make_engine):
    """The daily-loss auto-disarm is a protective stop too, so it must be sticky as well.

    Drives the REAL `_strategy_tick` guard (no market is tradable here, so the tick stops after the
    guard rather than attempting an entry), then reboots the engine to prove persistence.
    """
    engine, _fake = make_engine(armed_env=True, fair_shift_bps=0.0)
    engine.armed = True
    engine.day_start_equity = 1000.0
    engine.portfolio.daily_pnl = -100.0          # -10% against a 1.5% limit

    await engine._strategy_tick()

    assert engine.armed is False, "daily-loss breach did not disarm the engine"
    db = engine.cfg.db_path
    assert engine.store.kv_get("arm_state") == "disarmed", "auto-disarm was not persisted"
    engine.store._conn.close()

    rebooted = _boot(None, armed_env=True, db_path=db)
    assert rebooted._restore_arm_state()[0] is False, "auto-disarm did not survive a restart"
    rebooted.store._conn.close()


def test_clean_boot_respects_env(tmp_path):
    engine = _boot(tmp_path, armed_env=True)
    assert engine._restore_arm_state() == (True, "env_GIGPILOT_ARM")
    engine.store._conn.close()

    second = tmp_path / "second"
    second.mkdir(parents=True, exist_ok=True)
    other = _boot(second, armed_env=False)
    assert other._restore_arm_state() == (False, "env_GIGPILOT_ARM")
    other.store._conn.close()


def test_successful_arm_clears_a_prior_kill(tmp_path):
    """A kill can only be lifted by a fresh ARM, which re-runs the full preflight gate."""
    engine = _boot(tmp_path, armed_env=True)
    engine.kill()
    engine.store._conn.close()

    rebooted = _boot(tmp_path, armed_env=True)
    assert rebooted._restore_arm_state()[0] is False
    # Simulate the post-preflight bookkeeping that `arm()` performs on success.
    rebooted._persist_arm_state(rebooted.ARM_ARMED)
    rebooted.store._conn.close()

    again = _boot(tmp_path, armed_env=True)
    assert again._restore_arm_state() == (True, "env_GIGPILOT_ARM"), \
        "clearing the kill did not restore the configured ARM intent"
    again.store._conn.close()


def test_kill_is_journalled_before_any_unwind(tmp_path):
    """The kill must be durable even if the process dies mid-flatten."""
    engine = _boot(tmp_path, armed_env=True)
    engine.kill()
    row = engine.store._conn.execute(
        "SELECT payload FROM journal WHERE kind='KILL' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    assert row is not None, "kill produced no audit record"
    assert engine.store.kv_get("arm_state") == "killed"
    engine.store._conn.close()
