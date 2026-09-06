#!/usr/bin/env tsx
/**
 * CLI Tool: update_godaddy_dns
 * 
 * Usage:
 *   npx tsx scripts/update-godaddy-dns.ts
 *   npx tsx scripts/update-godaddy-dns.ts --target amplify
 *   npx tsx scripts/update-godaddy-dns.ts --target ec2
 *   npx tsx scripts/update-godaddy-dns.ts --key <KEY> --secret <SECRET>
 *   npx tsx scripts/update-godaddy-dns.ts --view-only
 */

import { fetchGoDaddyRecords, autoFixGoDaddyDns, getGoDaddyCredentials } from '../server/godaddyDnsService.js';

async function main() {
  const args = process.argv.slice(2);
  let domain = 'gigpilot.com';
  let target: 'ec2' | 'amplify' = 'ec2';
  let apiKey = '';
  let apiSecret = '';
  let viewOnly = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--domain' && args[i + 1]) domain = args[++i];
    else if (arg === '--target' && args[i + 1]) {
      const val = args[++i].toLowerCase();
      if (val === 'amplify' || val === 'ec2') target = val;
    }
    else if (arg === '--key' && args[i + 1]) apiKey = args[++i];
    else if (arg === '--secret' && args[i + 1]) apiSecret = args[++i];
    else if (arg === '--view-only' || arg === '-v') viewOnly = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
GoDaddy DNS Auto-Fix CLI
Usage:
  npx tsx scripts/update-godaddy-dns.ts [options]

Options:
  --target <ec2|amplify>   Choose target: 'ec2' (default: 3.222.149.9) or 'amplify' (d2qe2q720fbn3x.amplifyapp.com)
  --key <apiKey>           GoDaddy API Key (or set GODADDY_API_KEY env var)
  --secret <apiSecret>     GoDaddy API Secret (or set GODADDY_API_SECRET env var)
  --domain <domain>        Target domain (default: gigpilot.com)
  --view-only              Only list current DNS records without making changes
  --help                   Show this help message
`);
      process.exit(0);
    }
  }

  const creds = getGoDaddyCredentials(apiKey, apiSecret);

  console.log('\n======================================================');
  console.log('       🌐 GoDaddy DNS Auto-Fix Tool');
  console.log('======================================================');
  console.log(`Target Domain:   ${domain}`);
  console.log(`Target Routing:  ${target.toUpperCase()}`);
  console.log(`GoDaddy API URL: ${creds.baseUrl}`);
  console.log(`API Key Config:  ${creds.key ? '✔ Provided (' + creds.key.slice(0, 6) + '...)' : '❌ Not Set'}`);
  console.log(`API Secret:      ${creds.secret ? '✔ Provided (hidden)' : '❌ Not Set'}`);
  console.log('------------------------------------------------------\n');

  if (!creds.key || !creds.secret) {
    console.error('❌ Error: GoDaddy API Key and Secret are missing.');
    console.error('Please pass them via:');
    console.error('  1. Environment variables in Settings: GODADDY_API_KEY and GODADDY_API_SECRET');
    console.error('  2. Or CLI flags: --key <YOUR_KEY> --secret <YOUR_SECRET>\n');
    console.error('To generate your API keys:');
    console.error('  1. Visit: https://developer.godaddy.com/keys');
    console.error('  2. Click "Create New API Key"');
    console.error('  3. Choose Environment: "Production"\n');
    process.exit(1);
  }

  if (viewOnly) {
    console.log(`Fetching current DNS records for ${domain}...`);
    const res = await fetchGoDaddyRecords(domain, creds.key, creds.secret);
    if (!res.success) {
      console.error(`❌ Failed: ${res.error}`);
      process.exit(1);
    }
    console.log('\nCurrent DNS Records:');
    console.table(res.records?.map(r => ({ Type: r.type, Name: r.name, Data: r.data, TTL: r.ttl })));
    process.exit(0);
  }

  console.log(`🚀 Executing auto-fix on GoDaddy DNS for ${domain} -> ${target.toUpperCase()}...`);
  const result = await autoFixGoDaddyDns({
    domain,
    target,
    apiKey: creds.key,
    apiSecret: creds.secret,
  });

  if (!result.success) {
    console.error(`\n❌ Auto-fix failed: ${result.message}`);
    process.exit(1);
  }

  console.log(`\n✔ ${result.message}`);
  console.log('\nUpdated Records Applied:');
  console.table(result.updatedRecords.map(r => ({ Type: r.type, Name: r.name, Data: r.data, TTL: r.ttl })));
  console.log(`\n⏳ ${result.dnsPropagationNote}\n`);
}

main().catch(err => {
  console.error('Unhandled execution error:', err);
  process.exit(1);
});
