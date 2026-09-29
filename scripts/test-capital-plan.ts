/**
 * Regression tests for the capital/leverage planner and the credential probe.
 *
 * These two modules decide whether real money is allowed to move and whether the operator is
 * told the truth about why it is blocked, so the properties worth pinning are:
 *
 *  - the reserve is never breached, and the allocation cap is applied;
 *  - the requirement is derived from the exchange minimum and the level count, so the smallest
 *    valid grid is offered instead of an arbitrary fixed deposit;
 *  - leverage is ONLY able to reduce the cash required, is capped by both the configured risk
 *    limit and the exchange limit, and an out-of-range request is REFUSED rather than clamped
 *    (silently trading at a leverage the operator did not choose is the failure mode the limit
 *    exists to prevent);
 *  - an unresolvable exchange spec fails CLOSED rather than reporting "tradeable";
 *  - VALIDATING can never survive a probe: it becomes a definitive state, or an explicit ERROR.
 */

import {
  buildCapitalPlan,
  computeMaxAffordableLevels,
  computeMaxAllocatableUsd,
  computeMinMarginForGridUsd,
  computeRequiredMinCashUsd,
  resolveLeverage,
} from '../server/trading/capitalPlan.js';
import { CredentialProbe, mapAccountProbeToCredentialStatus } from '../server/trading/credentialProbe.js';

let passed = 0;
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}`);
    failed++;
  }
}

function eq(actual: unknown, expected: unknown, label: string): void {
  check(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

function approx(actual: number, expected: number, label: string): void {
  check(Math.abs(actual - expected) < 1e-9, `${label} (expected ${expected}, got ${actual})`);
}

console.log('================================================================');
console.log('CAPITAL PLAN + CREDENTIAL PROBE');
console.log('================================================================\n');

console.log('--- allocation honours the reserve and the cap ---');
eq(computeMaxAllocatableUsd(2.97, 200, 80), 0, 'cash below the reserve allocates nothing');
approx(computeMaxAllocatableUsd(500, 200, 80), 300, 'reserve binds: 500 - 200');
approx(computeMaxAllocatableUsd(1500, 200, 80), 1200, 'cap binds: 80% of 1500');
eq(computeMaxAllocatableUsd(-5, 200, 80), 0, 'negative cash cannot allocate');
eq(computeMaxAllocatableUsd(210, 200, 80), 10, 'just above the reserve allocates the excess');

console.log('\n--- the requirement comes from the exchange minimum, not a fixed deposit ---');
approx(computeMinMarginForGridUsd(5, 4, 1), 20, '4 rungs x 5 USDT at 1x');
approx(computeMinMarginForGridUsd(5, 4, 2), 10, 'leverage halves the margin required');
approx(computeMinMarginForGridUsd(5, 64, 1), 320, 'the same rule scales to a large grid');
eq(computeMinMarginForGridUsd(0, 4, 1), 0, 'an unknown minimum yields no claim');
eq(computeMaxAffordableLevels(20, 5, 1), 4, '20 USDT funds 4 rungs at 1x');
eq(computeMaxAffordableLevels(20, 5, 2), 8, 'the same 20 USDT funds 8 rungs at 2x');
eq(computeMaxAffordableLevels(0, 5, 1), 0, 'nothing allocatable funds nothing');

console.log('\n--- required cash is the point where BOTH constraints clear ---');
approx(computeRequiredMinCashUsd(200, 80, 20) as number, 220, 'reserve binds: 200 + 20');
approx(computeRequiredMinCashUsd(200, 80, 1000) as number, 1250, 'cap binds: 1000 / 0.8');
eq(computeRequiredMinCashUsd(200, 80, 0), null, 'no requirement is not a number we invent');

console.log('\n--- leverage ceiling is the lower of config and exchange, and out-of-range REFUSES ---');
{
  const ok = resolveLeverage(1, 1, 100, 1);
  eq([ok.effective, ok.rejected], [1, undefined], 'in-range leverage is accepted unchanged');
  eq(ok.ceilingSource, 'CONFIG_AND_EXCHANGE', 'ceiling attributed to both limits');

  const overConfig = resolveLeverage(5, 1, 100, 1);
  eq([overConfig.effective, overConfig.max], [1, 1], 'a request above the config limit is refused');
  check(Boolean(overConfig.rejected), 'refusal carries a reason');

  const overExchange = resolveLeverage(5, 10, 3, 1);
  eq([overExchange.effective, overExchange.max], [3, 3], 'the exchange limit lowers the ceiling');
  check(Boolean(overExchange.rejected), 'above the exchange limit is refused too');

  const noInstrument = resolveLeverage(2, 1, null, null);
  eq(noInstrument.max, 1, 'an unknown exchange limit falls back to the config ceiling');
  eq(noInstrument.ceilingSource, 'CONFIG', 'ceiling attributed to config only');
  check(Boolean(noInstrument.rejected), 'still refused rather than clamped');

  const stepMisaligned = resolveLeverage(3, 10, 100, 5);
  check(Boolean(stepMisaligned.rejected), 'a value off the exchange step is refused');

  eq(resolveLeverage(null, 3, 100, 1).effective, 1, 'no request defaults to 1x, not to the ceiling');
}

console.log('\n--- the live case: 2.97 USDT stays blocked, with the exact requirement named ---');
{
  const plan = buildCapitalPlan({
    availableCashUsd: 2.97,
    minAccountReserveUsd: 200,
    maxCapitalAllocationPct: 80,
    minNotionalUsd: 5,
    leverage: resolveLeverage(1, 1, 100, 1),
  });
  eq(plan.canTrade, false, 'a balance under the reserve cannot trade');
  eq(plan.maxAllocatableUsd, 0, 'nothing is allocatable');
  approx(plan.requiredMinCashUsd as number, 220, 'the exact balance required is reported');
  approx(plan.shortfallUsd as number, 217.03, 'and the exact shortfall');
  check(plan.reason.includes('220.00'), 'the reason names the required figure');
  check(plan.reason.includes('4-rung'), 'the reason names the smallest viable grid');
}

console.log('\n--- leverage is the capital-efficiency lever ---');
{
  const atOneX = buildCapitalPlan({
    availableCashUsd: 215,
    minAccountReserveUsd: 200,
    maxCapitalAllocationPct: 80,
    minNotionalUsd: 5,
    leverage: resolveLeverage(1, 1, 100, 1),
  });
  eq(atOneX.canTrade, false, '215 USDT cannot fund a 4-rung grid at 1x');

  const atTwoX = buildCapitalPlan({
    availableCashUsd: 215,
    minAccountReserveUsd: 200,
    maxCapitalAllocationPct: 80,
    minNotionalUsd: 5,
    leverage: resolveLeverage(2, 2, 100, 1),
  });
  eq(atTwoX.canTrade, true, 'the same balance can fund it at 2x');
  approx(atTwoX.requiredMinCashUsd as number, 210, 'and the requirement drops accordingly');
}

console.log('\n--- an unresolvable exchange spec fails CLOSED ---');
{
  const plan = buildCapitalPlan({
    availableCashUsd: 10_000,
    minAccountReserveUsd: 200,
    maxCapitalAllocationPct: 80,
    minNotionalUsd: 0,
    leverage: resolveLeverage(1, 1, null, null),
  });
  eq(plan.canTrade, false, 'a well-funded account is still blocked');
  eq(plan.requiredMinCashUsd, null, 'and no requirement is fabricated');
  check(/could not be resolved/i.test(plan.reason), 'the reason says the spec is unknown');
}

console.log('\n--- a funded account passes and reports its geometry ---');
{
  const plan = buildCapitalPlan({
    availableCashUsd: 500,
    minAccountReserveUsd: 200,
    maxCapitalAllocationPct: 80,
    minNotionalUsd: 5,
    leverage: resolveLeverage(1, 1, 100, 1),
    requestedLevels: 64,
  });
  eq(plan.canTrade, true, '500 USDT trades');
  approx(plan.maxAllocatableUsd, 300, 'allocatable is reported');
  eq(plan.effectiveLevels, 60, 'levels are clamped to what the balance actually funds');
  eq(plan.requestedLevels, 64, 'the request is echoed, not overwritten');
  approx(plan.perRungUsd, 5, 'per-rung notional is the exchange minimum');
}

console.log('\n--- credential status can never remain VALIDATING ---');
eq(mapAccountProbeToCredentialStatus({ status: 'CONNECTED' }).status, 'CONNECTED', 'CONNECTED maps through');
eq(mapAccountProbeToCredentialStatus({ status: 'RESTRICTED', message: 'withdrawals on' }).status, 'RESTRICTED', 'RESTRICTED maps through');
eq(mapAccountProbeToCredentialStatus({ status: 'DISCONNECTED' }).status, 'DISCONNECTED', 'DISCONNECTED maps through');
eq(mapAccountProbeToCredentialStatus({ status: 'SOMETHING_NEW' }).status, 'ERROR', 'an unknown state becomes an explicit ERROR');
eq(mapAccountProbeToCredentialStatus({ status: 'VALIDATING' }).status, 'ERROR', 'VALIDATING is never returned');
check(mapAccountProbeToCredentialStatus({ status: 'RESTRICTED', message: 'withdrawals on' }).errorMessage === 'withdrawals on', 'the failure reason is preserved');

console.log('\n--- the probe runs once, is single-flight, and recovers from failure ---');
await (async () => {
  let calls = 0;
  const probe = new CredentialProbe(async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 10));
    return { status: 'CONNECTED', timestamp: 't' };
  }, 1000);

  const [a, b] = await Promise.all([probe.resolve(true), probe.resolve(true)]);
  eq(calls, 1, 'concurrent callers share a single probe');
  eq(a?.status, 'CONNECTED', 'the shared result is returned to the first caller');
  eq(b?.status, 'CONNECTED', 'and to the second');
  eq(await probe.resolve(true), null, 'an already-resolved probe does not run again');
  eq(calls, 1, 'and does not call the exchange again');
  check(probe.isResolved, 'the probe reports itself resolved');

  probe.reset();
  check(!probe.isResolved, 'reset clears the verdict so new keys get validated');
  await probe.resolve(true);
  eq(calls, 2, 'and the probe runs again after reset');

  let failCalls = 0;
  const flaky = new CredentialProbe(async () => {
    failCalls++;
    if (failCalls === 1) throw new Error('network down');
    return { status: 'CONNECTED' };
  }, 1000);
  const first = await flaky.resolve(true, 1000);
  eq(first?.status, 'ERROR', 'a thrown probe becomes an explicit ERROR, not limbo');
  check(!flaky.isResolved, 'a failed probe does not settle the question');
  eq(await flaky.resolve(true, 1100), null, 'retries are rate-limited so the pre-flight cannot spam');
  const retried = await flaky.resolve(true, 3000);
  eq(retried?.status, 'CONNECTED', 'and it recovers on the next allowed attempt');

  const notNeeded = new CredentialProbe(async () => ({ status: 'CONNECTED' }));
  eq(await notNeeded.resolve(false), null, 'no probe when the state is already definitive');
})();

console.log('\n================================================================');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) process.exitCode = 1;
