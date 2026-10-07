"""ENGINE STATE — the arming lifecycle, deliberately SEPARATE from daemon health.

WHY THIS IS ITS OWN CONCEPT
---------------------------
A trading daemon has two independent questions asked about it, and conflating them took production
down:

  1. "Is this process doing its job?" — FastAPI responding, the database reachable, the public
     market-data feed connected and fresh. This is what a DEPLOY GATE is entitled to assert, and it
     must not depend on anything an operator has not done yet.
  2. "Is real capital authorised to move RIGHT NOW?" — whether a live credential is loaded and the
     engine is armed. This is an OPERATOR action that legitimately happens AFTER the release.

The September build had one flag doing both jobs: `healthy` folded in the private (authenticated)
WebSocket, which cannot connect before a credential exists. So a cold boot in runtime-secret mode
reported "unhealthy", `/api/health` answered 503, and the deploy gate refused the release — on a
deployment that was working exactly as designed. Worse, the failure was self-sealing: the only way
to supply the secret is `POST /api/arm` on this same server, so "unhealthy until armed" means
"cannot be armed".

`engine_state` names the second question so the two can finally be asserted separately.

THE STATES
----------
  AWAITING_SECRET  runtime-secret mode with no secret loaded. The process is UP and will accept a
                   secret; nothing can be signed until one arrives. This is a healthy, intended
                   resting state — NOT a fault.
  ARMED            live execution mode with the engine armed. Capital can move.
  DISARMED         live execution mode, not armed (kill switch, sticky disarm, or a refused
                   preflight). Deliberately NOT in DEPLOY_ACCEPTABLE_STATES: live mode was
                   requested and the engine is not live, which an operator needs to see rather than
                   have smoothed over.

FAIL-CLOSED CONVENTION
----------------------
Every input is a plain bool/str and the function is total: there is no input combination that
yields ARMED without live execution mode AND an armed engine. `secret_loaded` only ever REMOVES
capability, never grants it.
"""
from __future__ import annotations

AWAITING_SECRET = "AWAITING_SECRET"
ARMED = "ARMED"
DISARMED = "DISARMED"

#: Every state this module can report. Ordered by lifecycle.
ENGINE_STATES: tuple[str, ...] = (AWAITING_SECRET, ARMED, DISARMED)

#: States a DEPLOYMENT may legitimately observe. A release must never require that live trading has
#: already been armed with credentials: arming is an owner action performed after the rollout.
DEPLOY_ACCEPTABLE_STATES: tuple[str, ...] = (AWAITING_SECRET, ARMED, DISARMED)


def assess_engine_state(
    *,
    require_runtime_secret: bool,
    secret_loaded: bool,
    execution_mode: str,
    armed: bool,
) -> str:
    """Classify the engine's lifecycle state.

    Order matters. AWAITING_SECRET is checked FIRST because in runtime-secret mode the absence of a
    secret is the single dominant fact: it is why nothing can be signed, and reporting it as
    "DISARMED" would suggest an operator merely needs to press ARM, when in fact ARM cannot succeed
    without first supplying the secret.
    """
    if require_runtime_secret and not secret_loaded:
        return AWAITING_SECRET
    if str(execution_mode or "").strip().lower() != "live":
        # A non-live mode is now a CONFIGURATION ERROR, not a state: `Config.from_env` refuses it and
        # exits, so reaching here means something bypassed that. Report DISARMED — never a simulation
        # state — so an unexpected mode reads as "idle and doing nothing" rather than "running safely
        # in paper", which is the ambiguity this change exists to remove.
        return DISARMED
    return ARMED if armed else DISARMED


def ready_for_arming(state: str) -> bool:
    """True when the control plane will accept a runtime secret RIGHT NOW.

    True only in AWAITING_SECRET. In PAPER/ARMED a secret is either unnecessary or already loaded,
    and in DISARMED the blocker is a policy or preflight decision that supplying a secret would not
    clear — promising otherwise would send the operator down the wrong path.
    """
    return state == AWAITING_SECRET


def is_deploy_acceptable(state: str) -> bool:
    """Whether a release may proceed while the engine sits in this state."""
    return state in DEPLOY_ACCEPTABLE_STATES
