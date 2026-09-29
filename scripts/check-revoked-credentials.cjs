#!/usr/bin/env node
/**
 * Refuse to deploy with a credential that is known to be revoked or compromised.
 *
 * Rationale: a leaked exchange key is not made safe by rotating it in GitHub alone — the value
 * also lives on the host in `.env`, and an operator can easily update one and forget the other.
 * This turns "remember to rotate the host too" into a check that runs on every deployment.
 *
 * The list stores SHA-256 FINGERPRINTS (a 16-hex-character prefix), never the secrets, so it is
 * safe to commit and safe to read in a public log. A fingerprint cannot be reversed into the
 * credential it identifies.
 *
 * Usage:
 *   node scripts/check-revoked-credentials.cjs --env /path/.env --list security/revoked-credential-fingerprints.txt
 *
 * Exit codes: 0 = nothing revoked, 1 = a revoked credential is present (deploy must stop).
 *
 * ALLOW_REVOKED_CREDENTIALS=1 downgrades a match to a loud warning. That escape hatch exists so
 * a host can still be recovered when the only way to ship the fix is with the current key; it is
 * explicit and always logged, never silent.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');

const SENSITIVE = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|WEBHOOK)/i;

function parseArgs(argv) {
  const out = { env: null, list: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') out.env = argv[++i];
    else if (argv[i] === '--list') out.list = argv[++i];
    else throw new Error(`Unrecognised argument: ${argv[i]}`);
  }
  if (!out.env || !out.list) throw new Error('Usage: --env <path> --list <path>');
  return out;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

function readEnv(file) {
  const values = {};
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return values;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1);
    }
    if (v) values[m[1]] = v;
  }
  return values;
}

function readRevoked(file) {
  const entries = [];
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return entries;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [fp, ...rest] = line.split(/\s+/);
    entries.push({ fp: fp.toLowerCase(), label: rest.join(' ').replace(/^#\s*/, '') || 'revoked credential' });
  }
  return entries;
}

function main() {
  const { env, list } = parseArgs(process.argv.slice(2));
  const values = readEnv(env);
  const revoked = readRevoked(list);
  if (revoked.length === 0) {
    console.log('  No revoked fingerprints configured; nothing to enforce.');
    return;
  }

  const names = Object.keys(values).filter((k) => SENSITIVE.test(k));
  const hits = [];
  for (const name of names) {
    const fp = fingerprint(values[name]);
    for (const entry of revoked) {
      if (fp === entry.fp) hits.push(`${name} (${fp}) — ${entry.label}`);
    }
  }

  if (hits.length === 0) {
    console.log(`  ✔ ${names.length} credential(s) checked against ${revoked.length} revoked fingerprint(s); none match.`);
    return;
  }

  const detail = hits.map((h) => `    - ${h}`).join('\n');
  if (process.env.ALLOW_REVOKED_CREDENTIALS === '1') {
    console.log('  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.log('  WARNING: deploying with a REVOKED credential because');
    console.log('           ALLOW_REVOKED_CREDENTIALS=1. This is logged deliberately.');
    console.log(detail);
    console.log('  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    return;
  }

  console.error('ERROR: a revoked/compromised credential is still configured on this host:');
  console.error(detail);
  console.error('');
  console.error('Rotate it before deploying:');
  console.error('  1. Issue a new key at the exchange, restricted to this host’s IP, trade-only');
  console.error('     (withdrawals disabled).');
  console.error('  2. Update the authoritative store, e.g.');
  console.error('       aws ssm put-parameter --name /gigpilot/prod/BYBIT_API_SECRET \\');
  console.error('         --type SecureString --value "<new secret>" --overwrite');
  console.error('  3. Revoke the old key at the exchange, then re-run the deployment.');
  console.error('');
  console.error('To ship a fix without rotating first (logged as an override):');
  console.error('       ALLOW_REVOKED_CREDENTIALS=1 bash scripts/deploy-ec2.sh');
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
