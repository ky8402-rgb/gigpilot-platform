/**
 * Regression tests for scripts/update-env.js.
 *
 * The first two cases deliberately reproduce the failures of the `sed` command this replaces:
 *
 *   * a secret containing `|` made sed abort with "unterminated `s' command" — the reported
 *     production failure;
 *   * a secret containing `&` made sed write the *old* line into the new value, silently
 *     corrupting the credential instead of failing. Corruption is worse than a crash, because
 *     the deploy reports success and the platform then authenticates with a mangled key.
 *
 * Everything after that pins the properties that make credential updates trustworthy: hostile
 * characters round-trip byte-for-byte (including newlines), the JSON escaping is the exact
 * inverse of JSON parsing, an empty or unrepresentable value is refused rather than half-written,
 * duplicate keys collapse so dotenv cannot resolve a stale one, unrelated lines survive, the file
 * stays non-world-readable, and the secret never reaches stdout.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const UTIL = path.resolve('scripts/update-env.js');

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-env-'));
  const file = path.join(dir, '.env');
  if (contents) fs.writeFileSync(file, contents);
  return file;
}

/** KEY=VALUE argument form, exactly as the deployment invokes it. */
function updateArgv(file, ...pairs) {
  return execFileSync(process.execPath, [UTIL, '--file', file, ...pairs], { encoding: 'utf8' });
}

/** Value piped on stdin — the form used for real secrets so they stay out of `ps`. */
function updateStdin(file, key, value) {
  return execFileSync(process.execPath, [UTIL, '--file', file, '--stdin', key], {
    input: value,
    encoding: 'utf8',
  });
}

/**
 * Reader matching how the application (dotenv) reads the file: a double-quoted value is a JSON
 * string literal, so JSON.parse is the exact inverse of what the writer emits.
 */
function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      // Tolerate malformed literals so the sed-corruption cases can be *asserted on* rather than
      // crashing the reader. A correctly written value always parses.
      try {
        out[m[1]] = JSON.parse(raw);
      } catch {
        out[m[1]] = raw;
      }
    } else {
      out[m[1]] = raw;
    }
  }
  return out;
}

/** The exact command that failed in production. */
function oldSedWrite(file, key, value) {
  execFileSync('sed', ['-i', `s|^${key}=.*|${key}="${value}"|`, file], { encoding: 'utf8' });
}

console.log('================================================================');
console.log('update-env.js');
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
    `sed reports a broken s-expression (${(sedError || '').trim().slice(0, 58)})`,
  );

  updateArgv(file, `BYBIT_API_SECRET=${hostile}`);
  check(readEnv(file).BYBIT_API_SECRET === hostile, 'update-env stores it byte-for-byte');
}

console.log('\n--- the silent one: sed corrupts on & instead of failing ---');
{
  const hostile = 'AbC&dEf1234567890abcdefghijklmn';
  const file = tmpEnv('BYBIT_API_SECRET="old-secret"\n');
  try {
    oldSedWrite(file, 'BYBIT_API_SECRET', hostile);
  } catch {
    /* some seds refuse this; either way the utility below must be correct */
  }
  const viaSed = readEnv(file).BYBIT_API_SECRET;
  check(viaSed !== hostile, `sed did NOT store the value faithfully (got ${JSON.stringify(viaSed).slice(0, 38)})`);

  updateArgv(file, `BYBIT_API_SECRET=${hostile}`);
  check(readEnv(file).BYBIT_API_SECRET === hostile, 'update-env stores the & value exactly');
}

console.log('\n--- every character class requested, plus the usual suspects ---');
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
    'semicolon + syntax': 'a;rm -rf /;b',
    'command substitution': '$(touch /tmp/should-not-exist-update-env)',
    tab: 'aa\tbb',
    'carriage return': 'aa\rbb',
    newline: 'line1\nline2',
    'trailing newline': 'value\n',
  };
  for (const [label, value] of Object.entries(cases)) {
    const file = tmpEnv('OTHER=1\n');
    updateArgv(file, `BYBIT_API_SECRET=${value}`);
    const got = readEnv(file).BYBIT_API_SECRET;
    check(got === value, `${label} round-trips exactly${got === value ? '' : ` (got ${JSON.stringify(got)})`}`);
  }
  check(!fs.existsSync('/tmp/should-not-exist-update-env'), 'no value was ever evaluated by a shell');
}

console.log('\n--- JSON escaping is the exact inverse of JSON parsing ---');
{
  const file = tmpEnv('A=1\n');
  const values = ['/slash', 'pi|pe', 'a&m', 'back\\slash', 'quo"te', "apo'st", 'hash# tag', 'tab\there'];
  for (const v of values) {
    updateArgv(file, `K=${v}`);
  }
  const body = fs.readFileSync(file, 'utf8');
  check(/^K=".*"$/m.test(body), 'the value is stored as a JSON string literal');
  check(
    readEnv(file).K === values[values.length - 1],
    `the last write wins and parses back identically (${JSON.stringify(values[values.length - 1])})`,
  );
  check(
    body.split('\n').filter((l) => l.startsWith('K=')).length === 1,
    'repeated writes to one key leave a single line, not an appended pile',
  );

  // An embedded newline must survive as a single logical value, not split the file.
  const multi = tmpEnv('A=1\n');
  updateArgv(multi, 'MULTI=first\nsecond');
  const lines = fs.readFileSync(multi, 'utf8').split('\n');
  check(
    lines.filter((l) => l.startsWith('MULTI=')).length === 1,
    'a newline inside a value does not create a second assignment line',
  );
  check(readEnv(multi).MULTI === 'first\nsecond', 'and the value decodes back with the newline intact');
}

console.log('\n--- batch, stdin and JSON input forms ---');
{
  const file = tmpEnv('A=old-a\n');
  updateArgv(file, 'A=new-a', 'B=new-b', 'C=ne|w&c');
  const env = readEnv(file);
  check(env.A === 'new-a' && env.B === 'new-b' && env.C === 'ne|w&c', 'multiple KEY=VALUE pairs apply together');

  const viaStdin = tmpEnv('X=1\n');
  updateStdin(viaStdin, 'SECRET', 'std|in&value\\with"chars');
  check(readEnv(viaStdin).SECRET === 'std|in&value\\with"chars', 'the stdin form round-trips hostile values');

  const viaJson = tmpEnv('Y=1\n');
  execFileSync(process.execPath, [UTIL, '--file', viaJson, '--json', JSON.stringify({ P: 'a|b', Q: 'c&d' })], {
    encoding: 'utf8',
  });
  check(readEnv(viaJson).P === 'a|b' && readEnv(viaJson).Q === 'c&d', 'the JSON form applies every key');
}

console.log('\n--- fail closed instead of writing something broken ---');
{
  const file = tmpEnv('A=1\n');
  const attempt = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return String(e.stderr || e.message);
    }
  };

  const emptyErr = attempt(() => updateArgv(file, 'BYBIT_API_SECRET='));
  check(emptyErr !== null, 'an empty value is refused');
  check(/empty/i.test(emptyErr || ''), 'and says why');

  const allowEmpty = tmpEnv('A=1\n');
  updateArgv(allowEmpty, 'BYBIT_API_SECRET=', '--allow-empty');
  check(readEnv(allowEmpty).BYBIT_API_SECRET === '', '--allow-empty overrides deliberately');

  const noEq = attempt(() => updateArgv(file, 'JUSTAKEY'));
  check(noEq !== null, 'an argument without = is refused');

  const badKey = attempt(() => updateArgv(file, 'BAD KEY=x'));
  check(badKey !== null, 'a malformed key name is refused');

  const control = attempt(() => updateArgv(file, `K=bad${String.fromCharCode(7)}char`));
  check(control !== null, 'a control character dotenv cannot decode is refused');
  check(/control character/i.test(control || ''), 'and the refusal explains the dotenv mismatch');

  const badJson = attempt(() =>
    execFileSync(process.execPath, [UTIL, '--file', file, '--json', 'not-json'], { encoding: 'utf8' }),
  );
  check(badJson !== null, 'malformed --json is refused');

  check(fs.readFileSync(file, 'utf8').includes('A=1'), 'no refused call modified the file');
}

console.log('\n--- the file stays usable, unambiguous and private ---');
{
  const file = tmpEnv('BYBIT_API_KEY="k"\nOTHER=keep-me\n');
  updateArgv(file, 'BYBIT_API_SECRET=ne|w');
  const body = fs.readFileSync(file, 'utf8');
  check(body.includes('OTHER=keep-me'), 'unrelated lines are preserved');
  check(readEnv(file).BYBIT_API_KEY === 'k', 'other secrets are untouched');
  check(readEnv(file).BYBIT_API_SECRET === 'ne|w', 'the target key is updated');

  const dup = tmpEnv('BYBIT_API_SECRET="stale-one"\nA=1\nBYBIT_API_SECRET="stale-two"\n');
  updateArgv(dup, 'BYBIT_API_SECRET=fresh');
  check(
    fs.readFileSync(dup, 'utf8').split('\n').filter((l) => l.startsWith('BYBIT_API_SECRET=')).length === 1,
    'duplicate keys are collapsed to one',
  );
  check(readEnv(dup).BYBIT_API_SECRET === 'fresh', 'so dotenv cannot resolve a stale value');

  const fresh = path.join(path.dirname(tmpEnv()), 'brand-new.env');
  updateArgv(fresh, 'BYBIT_API_KEY=abc');
  check(readEnv(fresh).BYBIT_API_KEY === 'abc', 'a missing file is created');

  check((fs.statSync(file).mode & 0o077) === 0, 'group/other bits are cleared on write');
  const loose = tmpEnv('A=1\n');
  fs.chmodSync(loose, 0o644);
  updateArgv(loose, 'SECRET=x');
  check((fs.statSync(loose).mode & 0o077) === 0, 'a world-readable .env is tightened on write');
  fs.chmodSync(loose, 0o400);
  updateArgv(loose, 'SECRET=y');
  check((fs.statSync(loose).mode & 0o777) === 0o400, 'an already-stricter mode is preserved');
  check(
    fs.readdirSync(path.dirname(loose)).every((f) => !f.endsWith('.tmp')),
    'no temp file is left behind',
  );

  const dry = tmpEnv('A=1\n');
  execFileSync(process.execPath, [UTIL, '--file', dry, '--dry-run', 'A=2'], { encoding: 'utf8' });
  check(readEnv(dry).A === '1', '--dry-run changes nothing');
}

console.log('\n--- the secret never reaches stdout ---');
{
  const value = 'SuperSecretValueThatMustNotBeLogged123456';
  const file = tmpEnv('X=1\n');
  const stdout = updateArgv(file, `BYBIT_API_SECRET=${value}`);
  check(!stdout.includes(value), 'the value is absent from stdout');
  check(/sha256:[0-9a-f]{12}/.test(stdout), 'a short fingerprint is logged instead');
  check(stdout.includes('BYBIT_API_SECRET'), 'the key name is logged for traceability');
}

console.log('\n================================================================');
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('================================================================');

if (failed > 0) process.exitCode = 1;
