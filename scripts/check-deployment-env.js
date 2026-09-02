#!/usr/bin/env node

/**
 * Deployment Environment Variable & Key Verification Script
 * Validates critical environment variables before building or deploying.
 */

import fs from 'fs';
import path from 'path';

// Colors for terminal output
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';

console.log(`\n${BOLD}${CYAN}🔍 [GigPilot] Verifying Deployment Environment & API Credentials...${RESET}`);

// Load .env if present in current directory
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
    key: 'PAYPAL_RECEIVER_EMAIL',
    name: 'PayPal Merchant / Payout Email',
    category: 'paypal',
    required: false,
    default: 'kundank4@icloud.com',
    hint: 'Destination PayPal address for receiving client payments & bid winnings.'
  },
  {
    key: 'PAYPAL_ME_USERNAME',
    name: 'PayPal.Me Handle',
    category: 'paypal',
    required: false,
    default: 'ky8402',
    hint: 'Shortcode handle for instant PayPal.Me payment link generation.'
  },
  {
    key: 'PAYPAL_CLIENT_ID',
    name: 'PayPal REST Client ID',
    category: 'paypal',
    required: false,
    default: 'BAAv8rRenc5jlfD6eH_8pvgcU250jXTZCnyPKdBby13EAYRKhCempoPQ3Hj41GEfe2qBMu1P8ZslnbdkIc',
    hint: 'REST App Client ID for automated server-side order captures.'
  },
  {
    key: 'PAYPAL_CLIENT_SECRET',
    name: 'PayPal REST Client Secret',
    category: 'paypal',
    required: false,
    default: 'EH8CcxBIVPvFhoAKbL-HN8l_jSdOYzlGA2oahgGs1wPV7bogYK_TE4hIOjPtzOVj-mOUUXVy8uMIt6-N',
    hint: 'REST App Secret for automated webhook validation & refunds.'
  },
  {
    key: 'FREELANCER_ACCESS_TOKEN',
    name: 'Freelancer.com OAuth Token',
    category: 'freelancer',
    required: false,
    hint: 'Required for automated Freelancer.com bid submission & scraping API.'
  },
  {
    key: 'GEMINI_API_KEY',
    name: 'Google Gemini AI API Key',
    category: 'ai',
    required: false,
    hint: 'Required for AI proposal generation and autonomous job matching scoring.'
  },
  {
    key: 'DATABASE_URL',
    name: 'PostgreSQL / Supabase Database URL',
    category: 'database',
    required: false,
    hint: 'Durable cloud database connection string. Defaults to in-memory/sqlite if omitted.'
  },
  {
    key: 'JWT_SECRET',
    name: 'JWT Auth Secret Key',
    category: 'core',
    required: false,
    default: 'gigpilot_jwt_default_secret_prod_key',
    hint: 'Key for signing user session tokens.'
  }
];

let criticalMissing = 0;
let warnings = 0;
let configuredCount = 0;

console.log(`\n${BOLD}--- Environment Variable Status ---${RESET}`);

CHECKS.forEach((check) => {
  const value = process.env[check.key];
  const isPresent = Boolean(value && value.trim().length > 0);

  if (isPresent) {
    configuredCount++;
    const masked = value.length > 8 
      ? `${value.slice(0, 4)}...${value.slice(-4)}` 
      : '********';
    console.log(`  ${GREEN}✔${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${GREEN}Configured${RESET} ${DIM}[${masked}]${RESET}`);
  } else if (check.default) {
    console.log(`  ${YELLOW}▲${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${YELLOW}Using Default${RESET} ${DIM}[${check.default}]${RESET}`);
  } else if (check.required) {
    criticalMissing++;
    console.log(`  ${RED}✖${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${RED}MISSING (Required)${RESET}`);
    console.log(`    ${DIM}↳ Hint: ${check.hint}${RESET}`);
  } else {
    warnings++;
    console.log(`  ${YELLOW}○${RESET} ${BOLD}${check.key}${RESET} (${check.name}): ${YELLOW}Not Set (Optional/Fallback Active)${RESET}`);
    console.log(`    ${DIM}↳ ${check.hint}${RESET}`);
  }
});

console.log(`\n${BOLD}--- Summary ---${RESET}`);
console.log(`Total Configured: ${GREEN}${configuredCount}${RESET} / ${CHECKS.length}`);
console.log(`Optional / Fallbacks: ${YELLOW}${warnings}${RESET}`);

const isWarnOnly = process.argv.includes('--warn-only');

if (criticalMissing > 0) {
  console.error(`\n${RED}${BOLD}❌ Deployment Pre-check Failed: ${criticalMissing} required environment variables are missing.${RESET}`);
  if (!isWarnOnly) {
    process.exit(1);
  }
} else {
  console.log(`\n${GREEN}${BOLD}✅ Environment Pre-check Passed! System ready for build & deployment.${RESET}\n`);
}
