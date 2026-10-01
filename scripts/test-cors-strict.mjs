/**
 * Test Suite: CORS Security & CORS_STRICT Enforceability
 *
 * Verifies:
 * 1. Direct server-to-server / healthcheck requests (no Origin header) pass in all modes
 * 2. Localhost development ports pass in both permissive and strict modes
 * 3. Legitimate production domains (Amplify app, EC2 sslip.io, kundanvision.com, Cloud Run) pass
 * 4. In strict mode (CORS_STRICT=true):
 *    - Unknown attacker Amplify apps (e.g. evil.amplifyapp.com) are strictly blocked
 *    - Unknown attacker sslip.io hosts (e.g. 1-2-3-4.sslip.io) are strictly blocked
 *    - Arbitrary web origins (e.g. https://evil.com) are strictly blocked
 * 5. Environment custom allowlist takes precedence when configured
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { register } from 'tsx/esm/api';

const here = path.dirname(fileURLToPath(import.meta.url));
const unregister = register();
const moduleUrl = pathToFileURL(path.join(here, '..', 'server', 'corsConfig.ts')).href;
const { isAllowedOrigin } = await import(moduleUrl);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✔ ${message}`);
    passed++;
  } else {
    console.error(`  ✖ FAIL: ${message}`);
    failed++;
  }
}

console.log('--- CORS Security & CORS_STRICT Policy Suite ---');

const testOptionsStrict = {
  strictMode: true,
  amplifyAppId: 'd2qe2q720fbn3x',
  ec2Host: '35.154.110.156',
  allowedOrigins: ['https://custom-partner.com']
};

const testOptionsPermissive = {
  strictMode: false,
  amplifyAppId: 'd2qe2q720fbn3x',
  ec2Host: '35.154.110.156'
};

// 1. Direct server-to-server requests
console.log('\n[1] Direct & Server-to-Server Requests');
assert(isAllowedOrigin(undefined, testOptionsPermissive) === true, 'No origin (curl/CLI/internal) allowed in permissive mode');
assert(isAllowedOrigin(undefined, testOptionsStrict) === true, 'No origin (curl/CLI/internal) allowed in strict mode');
assert(isAllowedOrigin('', testOptionsStrict) === true, 'Empty origin allowed in strict mode');

// 2. Localhost Development
console.log('\n[2] Localhost Development');
assert(isAllowedOrigin('http://localhost:3000', testOptionsStrict) === true, 'localhost:3000 allowed in strict mode');
assert(isAllowedOrigin('http://127.0.0.1:3000', testOptionsStrict) === true, '127.0.0.1:3000 allowed in strict mode');
assert(isAllowedOrigin('http://[::1]:3000', testOptionsStrict) === true, 'IPv6 loopback allowed in strict mode');

// 3. Legitimate Production Origins
console.log('\n[3] Production Domains Verification');
assert(isAllowedOrigin('https://d2qe2q720fbn3x.amplifyapp.com', testOptionsStrict) === true, 'Exact Amplify app allowed in strict mode');
assert(isAllowedOrigin('https://main.d2qe2q720fbn3x.amplifyapp.com', testOptionsStrict) === true, 'Branch main.d2qe2q720fbn3x.amplifyapp.com allowed');
assert(isAllowedOrigin('https://35-154-110-156.sslip.io', testOptionsStrict) === true, 'Exact EC2 sslip.io host allowed in strict mode');
assert(isAllowedOrigin('https://kundanvision.com', testOptionsStrict) === true, 'Primary domain kundanvision.com allowed in strict mode');
assert(isAllowedOrigin('https://app.kundanvision.com', testOptionsStrict) === true, 'Subdomain app.kundanvision.com allowed in strict mode');
assert(isAllowedOrigin('https://preview-app.run.app', testOptionsStrict) === true, 'Google Cloud Run *.run.app allowed in strict mode');
assert(isAllowedOrigin('https://custom-partner.com', testOptionsStrict) === true, 'Explicit custom origin allowlist respected in strict mode');

// 4. Strict Mode Lockdown vs Permissive Wildcards
console.log('\n[4] Strict Mode Security Lockdown Proof');
// In permissive mode, unvetted amplify/sslip domains pass
assert(isAllowedOrigin('https://evil-unrelated.amplifyapp.com', testOptionsPermissive) === true, 'Permissive mode allows arbitrary .amplifyapp.com');
assert(isAllowedOrigin('https://99-99-99-99.sslip.io', testOptionsPermissive) === true, 'Permissive mode allows arbitrary .sslip.io');

// In STRICT mode, unvetted amplify/sslip domains are REJECTED
assert(isAllowedOrigin('https://evil-unrelated.amplifyapp.com', testOptionsStrict) === false, 'Strict mode BLOCKS unvetted .amplifyapp.com');
assert(isAllowedOrigin('https://attacker.d2qe2q720fbn3x.evil.com', testOptionsStrict) === false, 'Strict mode BLOCKS subdomain confusion attacks');
assert(isAllowedOrigin('https://99-99-99-99.sslip.io', testOptionsStrict) === false, 'Strict mode BLOCKS unvetted .sslip.io hosts');
assert(isAllowedOrigin('https://malicious-site.com', testOptionsStrict) === false, 'Strict mode BLOCKS arbitrary external origins');
assert(isAllowedOrigin('https://notkundanvision.com', testOptionsStrict) === false, 'Strict mode BLOCKS spoofed domain prefixes');

console.log(`\nCORS Security Suite: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL CORS SECURITY INVARIANTS HOLD.');
  process.exit(0);
}
