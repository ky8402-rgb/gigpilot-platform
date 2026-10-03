#!/usr/bin/env node
/**
 * OWNER TOKEN KEY CONSISTENCY.
 *
 * Regression origin: `tradingService.setStoredOwnerToken()` (what the owner login flow calls)
 * persists the session under `gigpilot_owner_token`, while `lib/api.ts` read `gigpilot_token` /
 * `token`. The result was that an owner could log in successfully and then have every request
 * issued through `apiClient`/`apiFetch` go out ANONYMOUS and be refused with 401 — the app looked
 * broken to someone who had just authenticated correctly.
 *
 * This is a whole-app invariant, not a component detail: a single mismatched key silently
 * unauthorises every request that flows through the shared client. It is checked structurally
 * because a unit test of either file alone would pass while the pair is broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0;
let failed = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  \u2714 ${label}`);
    passed++;
  } else {
    console.log(`  \u2716 ${label}${detail ? ` \u2014 ${detail}` : ''}`);
    failed++;
  }
}

const tradingService = fs.readFileSync(path.join(ROOT, 'src/services/tradingService.ts'), 'utf8');
const apiLib = fs.readFileSync(path.join(ROOT, 'src/lib/api.ts'), 'utf8');

// The canonical key is whatever the writer of the token declares.
const keyMatch = tradingService.match(/OWNER_TOKEN_STORAGE_KEY\s*=\s*['"]([^'"]+)['"]/);
const canonicalKey = keyMatch?.[1];

console.log('\n[1] The login flow persists the session under a declared key');
check('tradingService declares OWNER_TOKEN_STORAGE_KEY', Boolean(canonicalKey),
  'no OWNER_TOKEN_STORAGE_KEY found — the writer must declare the key');
check('setStoredOwnerToken writes using that key',
  /setStoredOwnerToken[\s\S]{0,200}?localStorage\.setItem\(OWNER_TOKEN_STORAGE_KEY/.test(tradingService));
check('getStoredOwnerToken reads using that key',
  /getStoredOwnerToken[\s\S]{0,200}?localStorage\.getItem\(OWNER_TOKEN_STORAGE_KEY/.test(tradingService));

console.log('\n[2] The shared API client reads the SAME key');
check('api.ts reads the canonical key',
  Boolean(canonicalKey) && apiLib.includes(`localStorage.getItem('${canonicalKey}')`),
  `api.ts does not read '${canonicalKey}' — logged-in requests would go out anonymous`);
check('the read is centralised in one helper',
  /export function getOwnerToken\(\)/.test(apiLib),
  'token reading should be a single exported helper, not repeated literals');
// The legacy chain is PERMITTED exactly once: inside getOwnerToken(), as a compatibility fallback
// for sessions already in a user's browser. Anywhere else it would be a legacy-only read that
// omits the canonical key — the original defect. Scope the check to everything OUTSIDE the helper.
const helperStart = apiLib.indexOf('export function getOwnerToken(');
const helperEnd = helperStart === -1 ? -1 : apiLib.indexOf('\n}', helperStart);
const outsideHelper = helperStart === -1 || helperEnd === -1
  ? apiLib
  : apiLib.slice(0, helperStart) + apiLib.slice(helperEnd);
check('legacy reads appear ONLY inside getOwnerToken (as a fallback)',
  !/localStorage\.getItem\('gigpilot_token'\)/.test(outsideHelper),
  'a legacy token read outside the helper omits the canonical key');

console.log('\n[3] Both transports attach the token');
const authHeaderUses = (apiLib.match(/Authorization\s*=\s*`Bearer \$\{token\}`/g) || []).length +
  (apiLib.match(/Authorization',\s*`Bearer \$\{token\}`/g) || []).length;
check('axios interceptor and fetch wrapper both set Authorization', authHeaderUses >= 2,
  `found ${authHeaderUses} Authorization attachment site(s), expected >= 2`);
check('the wrapper does not clobber a caller-supplied Authorization header',
  /!headers\.has\('Authorization'\)/.test(apiLib));

console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('OWNER TOKEN KEY MISMATCH.');
  process.exit(1);
}
console.log('OWNER TOKEN KEY IS CONSISTENT ACROSS THE APP.');
