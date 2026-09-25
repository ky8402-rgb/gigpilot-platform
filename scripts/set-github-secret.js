/**
 * Utility to set/update GitHub Actions repository secrets programmatically
 * using libsodium sealed-box encryption and GitHub REST API.
 * 
 * Usage:
 *   node scripts/set-github-secret.js <SECRET_NAME> <SECRET_VALUE>
 * Or via stdin:
 *   echo "value" | node scripts/set-github-secret.js <SECRET_NAME>
 */

const https = require('https');
const sodium = require('libsodium-wrappers');

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || 'ky8402-rgb/gigpilot-platform';

if (!token) {
  console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable required.');
  process.exit(1);
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const r = https.request({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'User-Agent': 'GigPilot-Secret-Tool',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

async function setSecret(secretName, secretValue) {
  await sodium.ready;
  const pkRes = await req('GET', `/repos/${repo}/actions/secrets/public-key`);
  if (pkRes.status !== 200) {
    throw new Error(`Failed to fetch public key: ${pkRes.status} ${pkRes.data}`);
  }
  const { key_id, key } = JSON.parse(pkRes.data);
  const keyBytes = Buffer.from(key, 'base64');
  const messageBytes = Buffer.from(secretValue.trim());
  const encryptedBytes = sodium.crypto_box_seal(messageBytes, keyBytes);
  const encryptedValue = Buffer.from(encryptedBytes).toString('base64');

  const putRes = await req('PUT', `/repos/${repo}/actions/secrets/${secretName}`, {
    encrypted_value: encryptedValue,
    key_id: key_id
  });

  if (putRes.status === 201 || putRes.status === 204) {
    console.log(`✔ Successfully updated GitHub Secret '${secretName}' (HTTP ${putRes.status})`);
  } else {
    throw new Error(`Failed to set secret '${secretName}': ${putRes.status} ${putRes.data}`);
  }
}

async function main() {
  const secretName = process.argv[2];
  let secretValue = process.argv[3];

  if (!secretName) {
    console.error('Usage: node scripts/set-github-secret.js <SECRET_NAME> [SECRET_VALUE]');
    process.exit(1);
  }

  if (!secretValue) {
    const fs = require('fs');
    secretValue = fs.readFileSync(0, 'utf-8');
  }

  await setSecret(secretName, secretValue);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
