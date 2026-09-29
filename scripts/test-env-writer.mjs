/**
 * Regression tests for the .env secret writer.
 *
 * The first two cases deliberately reproduce the failures of the `sed` command this replaces,
 * so the bug cannot come back:
 *
 *   * a secret containing `|` made sed abort with "unterminated `s' command" — the reported
 *     production failure;
 *   * a secret containing `&` made sed write the *old* line into the new value, silently
 *     corrupting the credential instead of failing. Corruption is worse than a crash, because
 *     the deploy reports success and the platform then authenticates with a mangled key.
 *
 * Everything after that pins the properties that make rotation trustworthy: hostile characters
 * round-trip byte-for-byte, an empty or multi-line value is refused rather than half-written,
 * duplicate keys are collapsed so dotenv cannot pick a stale one, unrelated lines survive, the
 * file stays 0600, and the secret never reaches stdout.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const WRITER = path.resolve('scripts/write-env-secret.cjs');

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}`);
    failed++;
  }
}

function tmpEnv(contents = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-writer-'));
  const file = path.join(dir, '.env');
  if (contents) fs.writeFileSync(file, contents);
  return file;
}

/** Invoke the writer with the value on stdin, exactly as the deploy script does. */
function write(file, key, value) {
  return execFileSync(process.execPath, [WRITER, key, '--file', file], {
    input: value,
    encoding: 'utf8',
  });
}

/** Minimal dotenv reader mirroring the quoting rules the writer emits. */
function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      v = v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    out[m[1]] = v;
  }
  return out;
}

/** The exact command that failed in production. */
function oldSedWrite(file, key, value) {
  execFileSync('sed', ['-i', `s|^${key}=.*|${key}="${value}"|`, file], { encoding: 'utf8' });
}

console.log('================================================================');
console.log('.ENV SECRET WRITER');
console.log('================================================================\n');

console.log('--- the reported failure: a secret containing the sed delimiter ---');
{
  const hostile = 'AbC|dEf1234567890abcdefghijklmn';
  const file = tmpEnv('BYBIT_API_SECRET="old"\n');
  let sedError = null;
  try {
    oldSedWrite(file, 'BYBIT_API_SECRET', hostile);
  } catch (err) {
    sedError = String(err.stderr || err.message);
  }
  check(sedError !== null, 'the old sed command genuinely fails on this input');
  // Wording differs by sed build — "unterminated `s' command" vs "unknown option to `s'" —
  // both mean the delimiter broke the expression. Match either.
  check(
    /unterminated|unknown option to .?s.?/i.test(sedError || ''),
    `sed reports a broken s-expression (${(sedError || '').trim().slice(0, 60)})`,
  );

  write(file, 'BYBIT_API_SECRET', hostile);
  check(readEnv(file).BYBIT_API_SECRET === hostile, 'the writer stores it byte-for-byte');
}

console.log('\n--- the silent one: sed corrupts on & instead of failing ---');
{
  const hostile = 'AbC&dEf1234567890abcdefghijklmn';
  const file = tmpEnv('BYBIT_API_SECRET="old-secret"\n');
  try {
    oldSedWrite(file, 'BYBIT_API_SECRET', hostile);
  } catch {
    /* some seds refuse this; either way the writer below must be correct */
  }
  const viaSed = readEnv(file).BYBIT_API_SECRET;
  check(viaSed !== hostile, `sed did NOT store the value faithfully (got ${JSON.stringify(viaSed).slice(0, 40)})`);

  write(file, 'BYBIT_API_SECRET', hostile);
  check(readEnv(file).BYBIT_API_SECRET === hostile, 'the writer stores the & value exactly');
}

console.log('\n--- every character class a real secret can contain ---');
{
  const cases = {
    'forward slash': 'aa/bb/cc+d=e',
    pipe: 'aa|bb|cc',
    ampersand: 'a&b&c',
    backslash: 'aa\\bb\\cc',
    'double quote': 'aa"bb"cc',
    'single quote': "aa'bb'cc",
    dollar: 'aa$bb${HOME}cc',
    backtick: 'aa`whoami`cc',
    hash: 'aa#bb cc',
    spaces: 'aa bb cc',
    'equals pad': 'YWJjZGVmPT0=',
    percent: 'aa%bb%cc',
    unicode: 'aa\u00e9\u00e8\u2713bb',
    'semicolon+syntax': 'a;rm -rf /;b',
    'command substitution': '$(touch /tmp/should-not-exist)',
  };
  for (const [label, value] of Object.entries(cases)) {
    const file = tmpEnv('OTHER=1\n');
    write(file, 'BYBIT_API_SECRET', value);
    check(readEnv(file).BYBIT_API_SECRET === value, `${label} round-trips exactly`);
  }
  check(!fs.existsSync('/tmp/should-not-exist'), 'no value was ever evaluated by a shell');
}

console.log('\n--- fail closed instead of writing something broken ---');
{
  const file = tmpEnv('A=1\n');
  let threw = null;
  try {
    write(file, 'BYBIT_API_SECRET', '');
  } catch (e) {
    threw = String(e.stderr || e.message);
  }
  check(threw !== null, 'an empty value is refused');
  check(/empty/i.test(threw || ''), 'and says why');

  threw = null;
  try {
    write(file, 'BYBIT_API_SECRET', 'line1\nline2');
  } catch (e) {
    threw = String(e.stderr || e.message);
  }
  check(threw !== null, 'a multi-line value is refused');
  check(!fs.readFileSync(file, 'utf8').includes('line1'), 'and nothing partial was written');

  threw = null;
  try {
    execFileSync(process.execPath, [WRITER, 'BAD KEY', '--file', file], { input: 'x', encoding: 'utf8' });
  } catch (e) {
    threw = String(e.stderr || e.message);
  }
  check(threw !== null, 'a malformed key name is refused');
}

console.log('\n--- the file stays usable and unambiguous ---');
{
  const file = tmpEnv('BYBIT_API_KEY="k"\nOTHER=keep-me\n');
  write(file, 'BYBIT_API_SECRET', 'new|secret');
  const body = fs.readFileSync(file, 'utf8');
  check(body.includes('OTHER=keep-me'), 'unrelated lines are preserved');
  check(readEnv(file).BYBIT_API_KEY === 'k', 'other secrets are untouched');
  check(readEnv(file).BYBIT_API_SECRET === 'new|secret', 'the target key is updated');
  const keyLines = body.split('\n').filter((l) => l.startsWith('BYBIT_API_SECRET='));
  check(keyLines.length === 1, 'the value occupies exactly one line');
  check(keyLines[0].length > 0 && (keyLines[0].match(/"/g) || []).length % 2 === 0, 'quoting is balanced');

  // A loose umask must not leave credentials world-readable.
  const loose = tmpEnv('BYBIT_API_KEY="k"\n');
  fs.chmodSync(loose, 0o644);
  write(loose, 'BYBIT_API_SECRET', 'tighten-me');
  check((fs.statSync(loose).mode & 0o077) === 0, 'a world-readable .env is tightened on write');
  fs.chmodSync(loose, 0o400);
  write(loose, 'BYBIT_API_SECRET', 'stay-tight');
  check((fs.statSync(loose).mode & 0o777) === 0o400, 'an already-stricter mode is preserved');

  const dup = tmpEnv('BYBIT_API_SECRET="stale-one"\nA=1\nBYBIT_API_SECRET="stale-two"\n');
  write(dup, 'BYBIT_API_SECRET', 'fresh');
  const dupBody = fs.readFileSync(dup, 'utf8');
  check(
    dupBody.split('\n').filter((l) => l.startsWith('BYBIT_API_SECRET=')).length === 1,
    'duplicate keys are collapsed to one',
  );
  check(readEnv(dup).BYBIT_API_SECRET === 'fresh', 'so dotenv cannot resolve a stale value');

  const fresh = path.join(path.dirname(tmpEnv()), 'brand-new.env');
  write(fresh, 'BYBIT_API_KEY', 'abc');
  check(readEnv(fresh).BYBIT_API_KEY === 'abc', 'a missing file is created');

  const perms = fs.statSync(file).mode & 0o777;
  check(perms === 0o600, `the credential file is 0600 (got ${perms.toString(8)})`);
  check(
    fs.readdirSync(path.dirname(file)).every((f) => !f.endsWith('.tmp')),
    'no temp file is left behind',
  );
}

console.log('\n--- the secret never reaches stdout ---');
{
  const value = 'SuperSecretValueThatMustNotBeLogged123456';
  const file = tmpEnv('X=1\n');
  const stdout = write(file, 'BYBIT_API_SECRET', value);
  check(!stdout.includes(value), 'the value is absent from stdout');
  check(/sha256:[0-9a-f]{12}/.test(stdout), 'a short fingerprint is logged instead');
  check(stdout.includes('BYBIT_API_SECRET'), 'the key name is logged for traceability');
}

console.log('\n================================================================');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) process.exitCode = 1;
