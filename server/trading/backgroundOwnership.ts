/**
 * Single-owner guard for background loops.
 *
 * `store.ts` ends with `export const globalTradingStore = new TradingStore()`, a module-level
 * side effect. Merely IMPORTING `./trading/store.js` therefore constructs the whole engine graph.
 * Several engines start periodic work in their constructors:
 *   - DataEngine            -> startLiveIngestion()      (public WS + REST polling)
 *   - ExchangeExecutionEngine -> startReconciliationLoop() (private-account reconciliation)
 *   - TradingStore          -> capital sync, order reconciliation, autonomous optimizer
 *
 * Two processes today import that module: the API (`dist/server.cjs`) and the worker
 * (`dist/worker.cjs`). Ungated, both run the full set of loops against ONE live Bybit account
 * while holding SEPARATE in-memory state — duplicate exchange calls, rate-limit pressure,
 * divergent capital/position views, and races on shared state (kill switch, off-switches,
 * order placement).
 *
 * Exactly one process may own background work. The owner leaves this flag unset; every other
 * process sets GIGPILOT_DISABLE_BACKGROUND_LOOPS=1 (see ecosystem.config.cjs).
 *
 * Operator-driven toggles (setOffSwitch, explicit start/stop methods) are deliberately NOT
 * gated by this: an operator acting on the API process must still be able to start work there.
 * This guards CONSTRUCTOR auto-start only, which is the part that leaks across processes.
 */
export const BACKGROUND_LOOPS_ENV_FLAG = 'GIGPILOT_DISABLE_BACKGROUND_LOOPS';

export function ownsBackgroundLoops(): boolean {
  return process.env[BACKGROUND_LOOPS_ENV_FLAG] !== '1';
}

export function backgroundLoopsDisabledReason(): string {
  return `background loops are not owned by this process (${BACKGROUND_LOOPS_ENV_FLAG}=1)`;
}
