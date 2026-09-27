import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const unregister = register();
const here = path.dirname(fileURLToPath(import.meta.url));
process.env.GEMINI_API_KEY = '';
const { AutonomousStrategyBuilder } = await import(pathToFileURL(path.join(here, '..', 'server', 'trading', 'autonomousStrategyBuilder.ts')).href);

const input = {
  capital: { netRealizedProfit: 100, totalTradingFees: 5, totalTrades: 30, currentDrawdownPct: 1 },
  grid: { gridSpacingPct: 0.72 },
  regime: { regime: 'RANGE_BOUND_LOW_VOL', atr: 40, bbBandwidth: 2, trendDirection: 'NEUTRAL' },
  research: [],
  champion: { id: 'champion', name: 'Champion', version: 'v1', parameters: { gridSpacingPct: 0.72 } }
};

const missing = new AutonomousStrategyBuilder();
assert.equal(missing.getBuilds().length, 0);
assert.equal(await missing.build(input), null);
assert.equal(missing.healthCheck().status, 'DEGRADED');

const recovered = new AutonomousStrategyBuilder();
recovered.client = () => ({ models: { generateContent: async () => ({ text: JSON.stringify({
  status: 'BUILT', strategyName: 'Validated Strategy', confidence: 0.88,
  rationale: 'Validated test response.', expectedEffect: 'Validated test effect.',
  parameters: { gridSpacingPct: 0.75, gridLevels: 16, volatilityMultiplier: 1.1, trendFilterEma: 50, rsiFilterThreshold: 35, rebalanceIntervalSec: 120 }
}) }) } });
process.env.GEMINI_API_KEY = 'test-only';
const build = await recovered.build(input);
assert.ok(build);
assert.equal(recovered.getBuilds().length, 1);
assert.equal(recovered.healthCheck().status, 'HEALTHY');

console.log('Strategy Builder safety regression tests: ALL PASSED');
unregister();
