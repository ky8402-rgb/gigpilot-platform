/**
 * End-to-End Verification Test for the Continuous Autonomous Reliability Loop
 * Tests the 7-stage engine and 5 synthetic canary probes.
 */

import { autonomousEngine } from '../server/aiops/autonomousLoop.js';
import { runSyntheticProbes } from '../server/aiops/syntheticProbes.js';

async function verifyAutonomousLoop() {
  console.log('================================================================');
  console.log('🚀 TESTING CONTINUOUS AUTONOMOUS RELIABILITY LOOP (7 STAGES)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${label}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      failed++;
    }
  }

  // 1. Synthetic Canary Probes (Stage 5)
  console.log('--- Test 1: Synthetic Canary Probes (5-point smoke test) ---');
  const probeSuite = await runSyntheticProbes();
  assert(probeSuite !== undefined, 'Synthetic probes returned a suite result');
  assert(probeSuite.total_probes === 5, 'Executed exactly 5 canary probes');
  assert(probeSuite.passed_count > 0, `At least 1 probe passed (Passed: ${probeSuite.passed_count}/${probeSuite.total_probes})`);
  assert(probeSuite.avg_latency_ms >= 0, `Average probe latency is calculated (${probeSuite.avg_latency_ms}ms)`);
  console.log(`    Probes: ${probeSuite.probes.map(p => `${p.name} [${p.status} ${p.latency_ms}ms]`).join(', ')}`);

  // 2. Autonomous Loop Status
  console.log('\n--- Test 2: Engine Initialization & Status ---');
  const initialStatus = autonomousEngine.getStatus();
  assert(initialStatus.enabled === true, 'Autonomous engine is enabled by default');
  assert(initialStatus.mode === 'autonomous', 'Engine default mode is autonomous');
  assert(initialStatus.pipeline_stages.length === 7, 'Engine defines all 7 continuous pipeline stages');
  assert(initialStatus.reliability_score >= 90, `Reliability score is healthy (${initialStatus.reliability_score}%)`);

  // 3. Execution of Full 7-Stage Autonomous Reliability Cycle
  console.log('\n--- Test 3: Full 7-Stage Cycle Execution ---');
  const execResult = await autonomousEngine.executeCycle('autonomous');
  assert(execResult !== undefined, 'Execution cycle returned a result');
  assert(typeof execResult.execution_id === 'string', `Generated execution ID: ${execResult.execution_id}`);
  assert(execResult.duration_total_ms > 0, `Cycle completed in ${execResult.duration_total_ms}ms`);

  // Stage 1: Telemetry Truth
  assert(execResult.stages.telemetry.status === 'success', 'Stage 1 (Telemetry Truth) collected metrics');
  assert(execResult.stages.telemetry.snapshot !== undefined, 'Telemetry snapshot exists');

  // Stage 2: Self-Diagnosis
  assert(execResult.stages.diagnosis.status === 'success', 'Stage 2 (Self-Diagnosis) completed');
  assert(typeof execResult.stages.diagnosis.root_cause === 'string', `Diagnosis root-cause: ${execResult.stages.diagnosis.root_cause}`);

  // Stage 3: Predictive ML
  assert(execResult.stages.prediction.status === 'success', 'Stage 3 (Predictive ML) forecast generated');
  assert(typeof execResult.stages.prediction.forecast.failure_probability === 'number', `Predicted failure probability: ${(execResult.stages.prediction.forecast.failure_probability * 100).toFixed(1)}%`);

  // Stage 4: Self-Healing Remediation
  assert(['executed', 'skipped_nominal', 'simulated'].includes(execResult.stages.remediation.status), `Stage 4 (Self-Healing) status: ${execResult.stages.remediation.status}`);
  assert(typeof execResult.stages.remediation.action_taken === 'string', `Action taken: ${execResult.stages.remediation.action_taken}`);

  // Stage 5: Self-Testing
  assert(['passed', 'failed'].includes(execResult.stages.testing.status), `Stage 5 (Self-Testing) completed: ${execResult.stages.testing.status}`);
  assert(execResult.stages.testing.test_suite.total_probes === 5, 'Tested with 5 synthetic canaries');

  // Stage 6: Self-Optimizing
  assert(['optimized', 'nominal'].includes(execResult.stages.optimization.status), `Stage 6 (Self-Optimizing) status: ${execResult.stages.optimization.status}`);
  assert(typeof execResult.stages.optimization.model_accuracy === 'number', `Optimized model accuracy: ${(execResult.stages.optimization.model_accuracy * 100).toFixed(1)}%`);

  // Stage 7: Safely Self-Updating
  assert(['stable', 'candidate_evaluated', 'promoted', 'rollback_ready'].includes(execResult.stages.self_updating.status), `Stage 7 (Safely Self-Updating) status: ${execResult.stages.self_updating.status}`);
  assert(typeof execResult.stages.self_updating.active_version === 'string', `Active model version: ${execResult.stages.self_updating.active_version}`);

  // 4. History and Status Update
  console.log('\n--- Test 4: History Tracking & State Update ---');
  const history = autonomousEngine.getHistory(5);
  assert(history.length >= 1, `History recorded ${history.length} execution(s)`);
  assert(history[0].execution_id === execResult.execution_id, 'Latest history item matches current execution');

  // 5. Mode Switching & Guardrails
  console.log('\n--- Test 5: Mode Switching & Dry-Run Guardrails ---');
  autonomousEngine.setMode('dry_run');
  assert(autonomousEngine.getStatus().mode === 'dry_run', 'Successfully set mode to dry_run');
  const dryRunExec = await autonomousEngine.executeCycle('dry_run');
  assert(dryRunExec.mode === 'dry_run', 'Dry-run executed with mode dry_run');
  assert(dryRunExec.stages.remediation.status === 'simulated' || dryRunExec.stages.remediation.status === 'skipped_nominal', 'Dry-run safely simulated or skipped state-mutating actions');
  autonomousEngine.setMode('autonomous');

  console.log('\n================================================================');
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

verifyAutonomousLoop().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
