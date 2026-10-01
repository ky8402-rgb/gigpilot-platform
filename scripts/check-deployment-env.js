#!/usr/bin/env node
/**
 * Deployment Environment Variable & Key Verification Script
 * Validates critical environment variables before building or deploying.
 * Ensures zero credentials or partial credential prefixes/suffixes are printed to logs or stdout.
 */
import fs from 'fs';
import path from 'path';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

console.log(`\n${BOLD}${CYAN}🔍 [Autonomous Crypto Grid Trading Platform] Verifying Deployment Environment...${RESET}`);

// Load .env if present in current directory without printing contents
const envPath = path.join(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...values] = trimmed.split('=');
        if (key && values.length > 0 && !process.env[key.trim()]) {
          process.env[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
        }
      }
    });
    console.log(`${DIM}Loaded local .env file variables for inspection.${RESET}`);
  } catch (e) {
    // Ignore read errors
  }
}

const CHECKS = [
  {
    key: 'GITHUB_TOKEN',
    name: 'GitHub Personal Access Token',
    category: 'gitops',
    required: false,
    hint: 'Enables automated git push to GitHub repository.'
  },
  {
    key: 'EC2_HOST',
    name: 'AWS EC2 Production Host',
    category: 'cloud',
    required: false,
    hint: 'Host IP or public DNS for backend zero-downtime reload.'
  },
  {
    key: 'AMPLIFY_APP_ID',
    name: 'AWS Amplify App ID',
    category: 'cloud',
    required: false,
    hint: 'AWS Amplify application ID for frontend CD sync.'
  },
  {
    key: 'PORT',
    name: 'Server Listening Port',
    category: 'server',
    required: false,
    hint: 'Port used by Express and reverse proxy routing.'
  },
  {
    key: 'GEMINI_API_KEY',
    name: 'Google Gemini AI API Key',
    category: 'ai',
    required: false,
    hint: 'Enables AI market intelligence synthesis and quant script optimization.'
  }
];

let criticalMissing = 0;
let configuredCount = 0;

console.log(`\n${BOLD}--- Environment Variable Status ---${RESET}`);

CHECKS.forEach((check) => {
  const value = process.env[check.key];
  const isPresent = Boolean(value && value.trim().length > 0);

  if (isPresent) {
    configuredCount++;
    // Never print any portion, prefix, or suffix of credentials or tokens
    console.log(`  ${GREEN}✔${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${GREEN}Configured (Protected)${RESET}`);
  } else if (check.required) {
    criticalMissing++;
    console.log(`  ${RED}✖${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${RED}MISSING (Required)${RESET}`);
    console.log(`    ${DIM}↳ Hint: ${check.hint}${RESET}`);
  } else {
    console.log(`  ${YELLOW}○${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${YELLOW}Not Set (Optional/Fallback Active)${RESET}`);
    console.log(`    ${DIM}↳ ${check.hint}${RESET}`);
  }
});

console.log(`\n${BOLD}--- Summary ---${RESET}`);
console.log(`Total Configured: ${GREEN}${configuredCount}${RESET} / ${CHECKS.length}`);

if (process.argv.includes('--strict') && criticalMissing > 0) {
  console.error(`\n${RED}✖ Deployment pre-flight checks failed with ${criticalMissing} missing required variable(s).${RESET}`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}✔ Pre-flight verification passed successfully.${RESET}\n`);
}
