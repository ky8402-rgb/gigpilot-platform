#!/usr/bin/env node
/**
 * Safely set or replace a key in a dotenv file.
 *
 * WHY THIS EXISTS
 * ---------------
 * The EC2 deploy script used to write secrets like this:
 *
 *     sed -i "s|^BYBIT_API_SECRET=.*|BYBIT_API_SECRET=\"$BYBIT_API_SECRET\"|" "$APP_DIR/.env"
 *
 * That is a shell-injection bug waiting on the value, not a style preference:
 *
 *   * `|` is the delimiter, so a secret containing `|` produces extra delimiters and sed dies
 *     with "unterminated `s' command" — the exact failure this script replaces.
 *   * `&` in a sed replacement expands to the WHOLE MATCH, so a secret containing `&` silently
 *     writes the old line back into the new value. It corrupts the credential instead of
 *     failing, which is far worse than an error.
 *   * `\` starts an escape, and a trailing `"` closes the quoting early.
 *
 * None of that can happen here: the value is never parsed by a shell or a regex engine, it is
 * treated as an opaque string and quoted explicitly for dotenv.
 *
 * USAGE
 *   node scripts/write-env-secret.js KEY --file /path/.env < /path/to/value
 *   printf '%s' "$SECRET" | node scripts/write-env-secret.js KEY --file /path/.env
 *
 * The value is read from STDIN on purpose: arguments are visible in `ps` to every user on the
 * box, so a secret must never be passed as argv. Only the key name and a short fingerprint are
 * ever printed.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Fingerprint for logs: identifies a secret without revealing it. */
function fingerprint(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

/**
 * True when dotenv would read the value back verbatim without quotes.
 * Anything else gets quoted, because characters like `#` (comment), whitespace and `=`
 * change meaning unquoted.
 */
function isBareSafe(value) {
  return /^[A-Za-z0-9_./:@%+-]*$/.test(value);
}

function quoteForDotenv(value) {
  if (isBareSafe(value)) return value;
  // Double quotes are the only dotenv form that supports embedded `#` and spaces; backslash and
  // double quote are the only escapes it recognises inside them.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function parseArgs(argv) {
  const args = { key: null, file: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') {
      args.file = argv[++i];
    } else if (a === '--key') {
      args.key = argv[++i];
    } else if (!args.key && !a.startsWith('-')) {
      args.key = a;
    } else {
      throw new Error(`Unrecognised argument: ${a}`);
    }
  }
  if (!args.key) throw new Error('Missing KEY. Usage: node scripts/write-env-secret.js KEY --file /path/.env < value');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(args.key)) {
    throw new Error(`Refusing a malformed environment key name: ${args.key}`);
  }
  return args;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  const { key, file } = parseArgs(process.argv.slice(2));
  if (!file) throw new Error('Missing --file path.');

  // Strip the single trailing newline a shell pipeline or `echo` adds; nothing else.
  let value = readStdin();
  if (value.endsWith('\n')) value = value.slice(0, -1);
  if (value.endsWith('\r')) value = value.slice(0, -1);

  if (value === '') {
    // Writing an empty secret would look like success and then fail authentication later with
    // no trace of why. Refuse instead.
    throw new Error(`Refusing to write an empty value for ${key}.`);
  }
  if (/[\r\n]/.test(value)) {
    // A newline cannot be represented on one dotenv line; writing it would silently truncate or
    // corrupt the file. No API secret legitimately contains one.
    throw new Error(`Refusing to write ${key}: the value contains a newline.`);
  }

  const target = path.resolve(file);
  let existing = '';
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const lines = existing.length ? existing.split('\n') : [];
  const replacement = `${key}=${quoteForDotenv(value)}`;
  const matcher = new RegExp(`^\\s*${key}\\s*=`);
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (matcher.test(line)) {
      // Keep exactly one entry. Duplicates let dotenv pick a different value than the one just
      // written, which is precisely how a "successful" rotation silently keeps using the old key.
      if (!replaced) {
        out.push(replacement);
        replaced = true;
      }
      continue;
    }
    out.push(line);
  }
  if (!replaced) {
    // Drop a trailing blank line before appending so repeated deploys do not accumulate them.
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push(replacement);
  }
  const next = out.join('\n') + '\n';

  // Atomic: a reader (or a crash) can never observe a half-written credential file.
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
  // Preserve the owner's own permission bits, but never inherit group/other access: a .env
  // holding API secrets must not stay world-readable just because it happened to be created
  // under a loose umask. Tightening is always safe; widening never is.
  let mode = 0o600;
  try {
    const existingMode = fs.statSync(target).mode & 0o777;
    if (existingMode !== 0) mode = (existingMode & 0o700) || 0o600;
  } catch {
    /* new file: use 0600 */
  }
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, target);

  console.log(`  ${key} written (len=${value.length}, sha256:${fingerprint(value)}, mode=${mode.toString(8)})`);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
