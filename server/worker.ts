/**
 * Autonomous Crypto Grid Trading Platform - Background Quantitative Worker
 * Continuously evaluates market regimes, runs adaptive grid recalculations,
 * monitors risk guardrails, and processes automated profit sweeping.
 */

import { globalTradingStore } from './trading/store.js';

console.log('🚀 [Trading Worker] Initialized Autonomous Crypto Grid Trading Background Worker...');

let isRunning = true;

// Periodic status heartbeat
const heartbeatInterval = setInterval(() => {
  if (!isRunning) return;
  const store = globalTradingStore;
  const cap = store.capital;
  const pos = store.exchange.getPosition(store.activeSymbol);
  
  console.log(
    `[Trading Worker Heartbeat] ${new Date().toISOString()} | Active: ${store.activeSymbol} | ` +
    `Mode: ${store.tradingMode} | Equity: $${cap.totalEquity.toFixed(2)} | ` +
    `Net Profit: $${cap.netRealizedProfit.toFixed(2)} | Position: ${pos ? pos.baseAmount.toFixed(4) : 0} ${store.activeSymbol.split('/')[0]}`
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
