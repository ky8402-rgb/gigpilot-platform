#!/usr/bin/env tsx
/**
 * CLI Tool: update_cloudflare_dns
 * 
 * Usage:
 *   npx tsx scripts/update-cloudflare-dns.ts --token <CLOUDFLARE_API_TOKEN>
 *   npx tsx scripts/update-cloudflare-dns.ts --view-only
 *   npx tsx scripts/update-cloudflare-dns.ts --action create --type A --name @ --content 3.222.149.9 --ttl 600
 */

import {
  getCloudflareZoneId,
  listCloudflareRecords,
  createCloudflareRecord,
  updateCloudflareRecord,
  deleteCloudflareRecord,
  executeGigpilotCloudflareMigration
} from '../server/cloudflareDnsService.ts';

async function main() {
  const args = process.argv.slice(2);
  let domain = 'ky7079.co';
  let token = process.env.CLOUDFLARE_API_TOKEN || '';
  let zoneId = domain === 'ky7079.co' ? '4bd2820de10e3037a95a41d823a53e6c' : (process.env.CLOUDFLARE_ZONE_ID || '');
  let ec2Ip = '3.222.149.9';
  let viewOnly = false;
  let action = 'migrate'; // 'migrate' | 'list' | 'create' | 'delete'
  let recordType = 'A';
  let recordName = '@';
  let recordContent = '';
  let recordTtl = 600;
  let recordId = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--token' && args[i + 1]) token = args[++i];
    else if (arg === '--zone-id' && args[i + 1]) zoneId = args[++i];
    else if (arg === '--domain' && args[i + 1]) domain = args[++i];
    else if (arg === '--ec2-ip' && args[i + 1]) ec2Ip = args[++i];
    else if (arg === '--view-only' || arg === '-v') viewOnly = true;
    else if (arg === '--action' && args[i + 1]) action = args[++i];
    else if ((arg === '--type' || arg === '--record-type') && args[i + 1]) recordType = args[++i];
    else if (arg === '--name' && args[i + 1]) recordName = args[++i];
    else if ((arg === '--content' || arg === '--value') && args[i + 1]) recordContent = args[++i];
    else if (arg === '--ttl' && args[i + 1]) recordTtl = parseInt(args[++i], 10);
    else if (arg === '--record-id' && args[i + 1]) recordId = args[++i];
  }

  console.log('\n======================================================');
  console.log('       ☁️ Cloudflare DNS Management Tool');
  console.log('======================================================');
  console.log(`Target Domain:   ${domain}`);
  console.log(`Cloudflare Auth: ${token ? '✔ Provided (' + token.slice(0, 6) + '...)' : '❌ Not Set'}`);
  console.log('------------------------------------------------------\n');

  if (!token) {
    console.error('❌ Error: Cloudflare API token is missing.');
    console.error('Please pass --token <TOKEN> or set CLOUDFLARE_API_TOKEN in environment variables.\n');
    process.exit(1);
  }

  // Resolve zone if not supplied
  if (!zoneId) {
    console.log(`Resolving Zone ID for ${domain}...`);
    const zoneRes = await getCloudflareZoneId(domain, token);
    if (!zoneRes.success || !zoneRes.zoneId) {
      console.error(`❌ ${zoneRes.error}`);
      process.exit(1);
    }
    zoneId = zoneRes.zoneId;
    console.log(`✔ Found Zone ID: ${zoneId}`);
  }

  if (viewOnly || action === 'list') {
    console.log(`\nFetching active DNS records for ${domain}...`);
    const res = await listCloudflareRecords(zoneId, token);
    if (!res.success) {
      console.error(`❌ Failed: ${res.error}`);
      process.exit(1);
    }
    console.log('\nCurrent Cloudflare DNS Records:');
    console.table(res.records?.map(r => ({
      ID: r.id,
      Type: r.type,
      Name: r.name,
      Content: r.content,
      TTL: r.ttl,
      Proxied: r.proxied
    })));
    process.exit(0);
  }

  if (action === 'delete' && recordId) {
    console.log(`Deleting record ${recordId}...`);
    const res = await deleteCloudflareRecord(zoneId, recordId, token);
    if (res.success) {
      console.log('✔ Record deleted successfully.');
    } else {
      console.error(`❌ Error deleting record: ${res.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (action === 'create') {
    console.log(`Creating record ${recordType} ${recordName} -> ${recordContent}...`);
    const res = await createCloudflareRecord(zoneId, {
      type: recordType,
      name: recordName,
      content: recordContent,
      ttl: recordTtl,
      proxied: false
    }, token);
    if (res.success) {
      console.log('✔ Record created successfully:', res.record);
    } else {
      console.error(`❌ Error creating record: ${res.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  if (action === 'update') {
    let targetId = recordId;
    if (!targetId) {
      const listRes = await listCloudflareRecords(zoneId, token);
      const match = listRes.records?.find(
        r => (r.name === recordName || r.name === `${recordName}.${domain}` || (recordName === '@' && r.name === domain)) &&
             r.type.toUpperCase() === recordType.toUpperCase()
      );
      if (match?.id) {
        targetId = match.id;
      } else {
        console.error(`❌ No record found matching ${recordType} ${recordName} to update.`);
        process.exit(1);
      }
    }
    console.log(`Updating record ${recordType} ${recordName} (ID: ${targetId}) -> ${recordContent}...`);
    const res = await updateCloudflareRecord(zoneId, targetId, {
      type: recordType,
      name: recordName === '@' ? domain : recordName,
      content: recordContent,
      ttl: recordTtl,
      proxied: false,
    }, token);
    if (res.success) {
      console.log('✔ Record updated successfully:', res.record);
    } else {
      console.error(`❌ Error updating record: ${res.error}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Default action: migrate
  console.log(`🚀 Executing full DNS migration for ${domain} -> EC2 ${ec2Ip}...`);
  const result = await executeGigpilotCloudflareMigration({
    domain,
    ec2Ip,
    token,
    zoneId
  });

  if (!result.success) {
    console.error(`\n❌ Migration failed: ${result.message}`);
    process.exit(1);
  }

  console.log(`\n✔ ${result.message}`);
  if (result.deletedRecords.length > 0) {
    console.log(`Deleted ${result.deletedRecords.length} old/conflicting records.`);
  }
  console.log('\nActive Records in Cloudflare:');
  console.table(result.allActiveRecords.map(r => ({
    Type: r.type,
    Name: r.name,
    Content: r.content,
    TTL: r.ttl,
    Proxied: r.proxied
  })));
  console.log('\n✔ DNS migration successfully applied on Cloudflare!\n');
}

main().catch(err => {
  console.error('Unhandled CLI error:', err);
  process.exit(1);
});
