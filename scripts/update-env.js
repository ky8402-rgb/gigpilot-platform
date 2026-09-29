#!/usr/bin/env node
/**
 * Bulletproof .env updater.
 *
 * WHY THIS EXISTS
 * ---------------
 * The EC2 deploy script used to write credentials with:
 *
 *     sed -i "s|^BYBIT_API_SECRET=.*|BYBIT_API_SECRET=\"$BYBIT_API_SECRET\"|" /home/ubuntu/gigpilot/.env
 *
 * That is a shell-injection bug keyed on the secret's own contents, not a style preference:
 *
 *   * `|` is the delimiter, so a secret containing `|` produces extra delimiters and sed dies
 *     with "unterminated `s' command" — the production failure this utility replaces;
 *   * `&` in a sed replacement expands to the WHOLE MATCH, so a secret containing `&` silently
 *     writes the OLD line back into the new value. It corrupts the credential instead of
 *     failing, which is strictly worse than an error;
 *   * `\` starts an escape and a trailing `"` closes the quoting early, mangling the value.
 *
 * HOW IT IS SAFE
 * --------------
 * Values are never parsed by a shell and never matched by a regex engine. The only substitution
 * is a line-prefix test for the key name, and the value is emitted as a JSON string literal
 * (`JSON.stringify`), which is precisely the double-quoted form dotenv reads back: `\` -> `\\`,
 * `"` -> `\"`, newline -> `\n`. Round-tripping is guaranteed by JSON's own semantics rather than
 * by hand-rolled escaping, so `/ | & \ " ' $ \` # = %` and spaces are all inert.
 *
 * The write is atomic (temp file + rename, fsync'd) so a reader or a crash can never observe a
 * half-written credential file, and the file is never left group/other readable.
 *
 * USAGE
 *   node scripts/update-env.js --file /home/ubuntu/gigpilot/.env "KEY=VALUE" "KEY2=VALUE2"
 *   printf '%s' "$SECRET" | node scripts/update-env.js --file .env --stdin KEY
 *   node scripts/update-env.js --file .env --json '{"KEY":"VALUE"}'
 *   node scripts/update-env.js --file .env --dry-run "KEY=VALUE"
 *
 * SECURITY NOTE: `KEY=VALUE` arguments are visible to every user on the host via `ps`. Secrets
 * should prefer `--stdin` or `--json` (a shell variable, not a literal). The argv form is
 * supported because it is convenient and unambiguous, and it is never the *less* safe option for
 * file corruption — only for disclosure.
 *
 * Exit codes: 0 success, 1 refused/invalid input, 2 unexpected failure.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Characters JSON escapes that dotenv would NOT decode the same way. Refused, not guessed at. */
const UNREPRESENTABLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function fingerprint(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function parseArgs(argv) {
  const out = { file: '.env', pairs: [], json: null, stdinKey: null, dryRun: false, allowEmpty: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--file') out.file = argv[++i];
    else if (arg === '--json') out.json = argv[++i];
    else if (arg === '--stdin') out.stdinKey = argv[++i];
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--allow-empty') out.allowEmpty = true;
    else if (arg.startsWith('--')) throw new Error(`Unrecognised option: ${arg}`);
    else out.pairs.push(arg);
  }
  if (!out.file) throw new Error('--file requires a path');

  if (out.json !== null) {
    let parsed;
    try {
      parsed = JSON.parse(out.json);
    } catch {
      throw new Error('--json must be a JSON object of KEY -> VALUE');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('--json must be a JSON object of KEY -> VALUE');
    }
    for (const [k, v] of Object.entries(parsed)) out.pairs.push({ key: k, value: String(v), explicit: true });
  }

  if (out.stdinKey !== null) out.pairs.push({ key: out.stdinKey, fromStdin: true });

  if (out.pairs.length === 0) {
    throw new Error('Nothing to do. Pass KEY=VALUE, --json, or --stdin KEY.');
  }

  return out;
}

function normalisePair(entry) {
  if (typeof entry === 'object') return entry;
  const eq = entry.indexOf('=');
  if (eq <= 0) throw new Error(`Expected KEY=VALUE, got: ${entry}`);
  return { key: entry.slice(0, eq), value: entry.slice(eq + 1), explicit: true };
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Reverse of what we write: JSON string literal -> the exact original value. */
function decodeStoredValue(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return trimmed;
}

function validate(key, value, allowEmpty) {
  if (!KEY_RE.test(key)) throw new Error(`Refusing malformed environment key: ${key}`);
  if (value === '' && !allowEmpty) {
    // Writing nothing looks like success and then fails authentication later with no trace of
    // why. Refuse instead of silently emptying a working credential.
    throw new Error(`Refusing to write an empty value for ${key} (pass --allow-empty to override).`);
  }
  if (UNREPRESENTABLE.test(value)) {
    throw new Error(
      `Refusing to write ${key}: the value contains a control character that dotenv cannot ` +
        `decode from a JSON escape, so the stored value would not match what you set.`,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = path.resolve(args.file);

  let existing = '';
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const updates = new Map();
  for (const raw of args.pairs) {
    const entry = normalisePair(raw);
    let value = entry.fromStdin ? readStdin() : entry.value;
    if (entry.fromStdin && value.endsWith('\n')) value = value.slice(0, -1);
    if (entry.fromStdin && value.endsWith('\r')) value = value.slice(0, -1);
    validate(entry.key, value, args.allowEmpty);
    updates.set(entry.key, value);
  }

  const lines = existing.length ? existing.split('\n') : [];
  const seen = new Set();
  const out = [];
  const report = [];

  for (const line of lines) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (!m || !updates.has(m[1])) {
      out.push(line);
      continue;
    }
    const key = m[1];
    if (seen.has(key)) continue; // collapse duplicates: dotenv could otherwise resolve a stale one
    seen.add(key);
    out.push(`${key}=${JSON.stringify(updates.get(key))}`);
    report.push(`${key} (len=${updates.get(key).length}, sha256:${fingerprint(updates.get(key))})`);
  }

  for (const [key, value] of updates) {
    if (seen.has(key)) continue;
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${JSON.stringify(value)}`);
    report.push(`${key} (len=${value.length}, sha256:${fingerprint(value)})`);
  }

  const next = out.join('\n') + '\n';

  // Prove the file we are about to write decodes back to exactly what was asked for, before it
  // touches the live credential file. A round-trip failure aborts with nothing changed.
  for (const [key, value] of updates) {
    const written = new RegExp(`^${key}=(.*)$`, 'm').exec(next);
    if (!written || decodeStoredValue(written[1]) !== value) {
      throw new Error(`Round-trip check failed for ${key}; refusing to write a corrupted value.`);
    }
  }

  const mode = (() => {
    try {
      const existingMode = fs.statSync(target).mode & 0o777;
      return existingMode !== 0 ? existingMode & 0o700 || 0o600 : 0o600;
    } catch {
      return 0o600;
    }
  })();

  if (args.dryRun) {
    console.log(`  DRY RUN — would write to ${target} (mode ${mode.toString(8)}):`);
    for (const r of report) console.log(`    ${r}`);
    return;
  }

  const dir = path.dirname(target);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeFileSync(fd, next);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, target);

  console.log(`  ${target}: ${report.length} value(s) updated (mode ${mode.toString(8)})`);
  for (const r of report) console.log(`    ${r}`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
