/**
 * Background / Liveness Worker.
 *
 * WHAT THIS PROCESS DELIBERATELY DOES NOT DO
 * -----------------------------------------
 * It does not run trading, reconciliation, capital-sync or optimizer loops — and that is a
 * correctness requirement, not an omission.
 *
 * `import { globalTradingStore } from './trading/store.js'` constructs the store as a module
 * side effect, and several engines auto-start periodic work in their constructors
 * (DataEngine -> live Bybit ingestion, ExchangeExecutionEngine -> reconciliation loop,
 * TradingStore -> capital sync / order reconciliation / autonomous optimizer).
 *
 * If those auto-starts were not gated, this process would run a complete SECOND set of loops
 * against the SAME live Bybit account while holding its own separate in-memory state: duplicate
 * exchange calls, divergent capital and position views, and races on shared state. The API
 * process (`dist/server.cjs`) is the single owner of all background work; this process sets
 * GIGPILOT_DISABLE_BACKGROUND_LOOPS=1 (see ecosystem.config.cjs and backgroundOwnership.ts).
 *
 * This process therefore provides process-level liveness/telemetry only.
 */

import { globalTradingStore } from './trading/store.js';
import { BACKGROUND_LOOPS_ENV_FLAG, ownsBackgroundLoops } from './trading/backgroundOwnership.js';

if (ownsBackgroundLoops()) {
  // Fail LOUDLY rather than quietly becoming a second trading process. Starting this worker
  // without the flag means duplicate reconcilers and a duplicate optimizer against the live
  // account, so refusing to start is the fail-closed choice.
  console.error(
    `[Trading Worker] FATAL: ${BACKGROUND_LOOPS_ENV_FLAG} is not set to "1".\n` +
    '  This process would run a duplicate set of reconciliation, ingestion and optimizer loops\n' +
    '  against the live account, with separate in-memory state. Refusing to start.\n' +
    '  Fix: set GIGPILOT_DISABLE_BACKGROUND_LOOPS=1 on the pm2 "worker" app (ecosystem.config.cjs).'
  );
  process.exit(1);
}

console.log(
  '[Trading Worker] Started as a liveness/telemetry worker. ' +
  'Background trading loops are owned by the API process, not here.'
);

let isRunning = true;

// Liveness heartbeat. Reports only what this process can actually observe; it does not claim
// to be running work that the API process owns.
const heartbeatInterval = setInterval(() => {
  if (!isRunning) return;
  const store = globalTradingStore;
  console.log(
    `[Trading Worker Heartbeat] ${new Date().toISOString()} | process alive | ` +
    `mode: ${store.tradingMode} | background loops: DISABLED here (owned by API process)`
  );
}, 30000);

process.on('SIGTERM', () => {
  console.log('[Trading Worker] SIGTERM received. Shutting down gracefully...');
  isRunning = false;
  clearInterval(heartbeatInterval);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Trading Worker] SIGINT received. Shutting down gracefully...');
  isRunning = false;
  clearInterval(heartbeatInterval);
  process.exit(0);
});
