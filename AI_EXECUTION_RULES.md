# GigPilot AI Execution Rule

## All-Fixes-at-a-Time Rule

For GigPilot maintenance, debugging, hardening, and upgrades:

1. Audit the relevant codebase and identify the complete set of known fixes and upgrades required for the current objective.
2. Apply **all identified fixes and upgrades in the current work cycle**, rather than stopping after one fix.
3. Keep the changes coherent and internally consistent; do not intentionally leave known dependent fixes unfinished.
4. After the complete fix set is applied, run the full available CI/build/type-check/test validation.
5. If validation fails, diagnose the failure, apply the necessary corrections, and rerun validation until the current work cycle is clean or a genuine external blocker is reached.
6. Verify deployment status for the resulting commit before declaring the work complete.
7. Do not claim a fix is deployed or validated unless the corresponding CI/deployment evidence has been checked.
8. Preserve live-trading safety constraints: never weaken authentication, exchange credential protections, risk limits, kill switches, withdrawal controls, or other explicit security boundaries merely to make validation pass.
9. For autonomous optimization, optimize for sustainable real realized net profit after fees using live production evidence only; never substitute mock, synthetic, paper-trading, simulation, or fabricated market data.
10. When a failure exposes additional related defects, include those defects in the same current fix cycle when they are necessary to achieve the stated objective. Do not defer them solely to preserve a one-fix-at-a-time workflow.

### Completion standard

A work cycle is complete only when:
- all identified fixes for the current objective have been implemented;
- validation has been rerun after the complete set;
- deployment has been checked; and
- any remaining blocker is explicitly documented with evidence.

This rule supersedes the previous **one-fix-at-a-time** workflow for GigPilot work.
