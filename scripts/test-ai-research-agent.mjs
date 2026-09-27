import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const { AutonomousResearchAgent } = await import(pathToFileURL(path.join(here, '..', 'server', 'trading', 'researchAgent.ts')).href);

const originalKey = process.env.GEMINI_API_KEY;
const restore = () => {
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalKey;
};

try {
  delete process.env.GEMINI_API_KEY;
  const missing = new AutonomousResearchAgent();
  assert.equal(missing.getResearchItems().length, 0);
  assert.equal(missing.healthCheck().status, 'DEGRADED');
  const missingResult = await missing.evaluateLiveMarketIntelligence('DOGE/USDT', 0.12, 1.5);
  assert.equal(missingResult.success, false);
  assert.match(missingResult.error, /GEMINI_API_KEY/);

  process.env.GEMINI_API_KEY = 'test-only-not-a-real-credential';
  const recovered = new AutonomousResearchAgent();
  recovered.getAiClient = () => ({
    models: { generateContent: async () => ({ text: JSON.stringify({
      title: 'DOGE live market structure', category: 'ANALYSIS', sentiment: 'NEUTRAL',
      impactScore: 5, summary: 'Test-only structured analysis.', riskLevel: 'MEDIUM',
      recommendedGridWidthModifier: 1.05, notes: 'Test-only quant guidance.'
    }) }) }
  });
  assert.equal(recovered.healthCheck().status, 'DEGRADED');
  const ok = await recovered.evaluateLiveMarketIntelligence('DOGE/USDT', 0.12, 1.5);
  assert.equal(ok.success, true);
  assert.equal(recovered.healthCheck().status, 'HEALTHY');
  assert.equal(recovered.getResearchItems().length, 1);

  const timeout = new AutonomousResearchAgent();
  timeout.getAiClient = () => ({ models: { generateContent: () => new Promise(() => {}) } });
  timeout.requestTimeoutMs = 5;
  const timeoutResult = await timeout.evaluateLiveMarketIntelligence('DOGE/USDT', 0.12, 1.5);
  assert.equal(timeoutResult.success, false);
  assert.match(timeoutResult.error, /timed out|timeout/i);
  assert.equal(timeout.healthCheck().status, 'DEGRADED');

  const rateLimited = new AutonomousResearchAgent();
  rateLimited.getAiClient = () => ({ models: { generateContent: async () => { throw Object.assign(new Error('quota'), { status: 429 }); } } });
  const rateResult = await rateLimited.evaluateLiveMarketIntelligence('DOGE/USDT', 0.12, 1.5);
  assert.equal(rateResult.success, false);
  assert.match(rateResult.error, /rate limited/i);
  assert.equal(rateLimited.healthCheck().status, 'DEGRADED');

  const malformed = new AutonomousResearchAgent();
  malformed.getAiClient = () => ({ models: { generateContent: async () => ({ text: '{"title":"missing fields"}' }) } });
  const malformedResult = await malformed.evaluateLiveMarketIntelligence('DOGE/USDT', 0.12, 1.5);
  assert.equal(malformedResult.success, false);
  assert.equal(malformed.getResearchItems().length, 0);
  assert.equal(malformed.healthCheck().status, 'DEGRADED');

  console.log('AI Research Agent regression tests: ALL PASSED');
} finally {
  restore();
  unregister();
}
