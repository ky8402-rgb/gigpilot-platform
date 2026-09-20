const raw = process.env.SECRET_JSON || '';
if (!raw || raw === 'None') process.exit(0);
let secret;
try { secret = JSON.parse(raw); } catch { process.exit(0); }
const aliases = {
  PAYPAL_CLIENT_ID: ['PAYPAL_CLIENT_ID', 'paypal_client_id', 'client_id'],
  PAYPAL_CLIENT_SECRET: ['PAYPAL_CLIENT_SECRET', 'paypal_client_secret', 'PAYPAL_SECRET', 'paypal_secret', 'client_secret'],
  PAYPAL_RECEIVER_EMAIL: ['PAYPAL_RECEIVER_EMAIL', 'paypal_receiver_email', 'receiver_email'],
  PAYPAL_MODE: ['PAYPAL_MODE', 'paypal_mode', 'mode'],
  FREELANCER_ACCESS_TOKEN: ['FREELANCER_ACCESS_TOKEN', 'freelancer_access_token', 'FREELANCER_OAUTH_TOKEN', 'freelancer_oauth_token'],
  FREELANCER_USER_ID: ['FREELANCER_USER_ID', 'freelancer_user_id', 'user_id'],
};
const existing = new Set(['PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET','PAYPAL_RECEIVER_EMAIL','PAYPAL_MODE','FREELANCER_ACCESS_TOKEN','FREELANCER_USER_ID'].filter(k => process.env[k]));
for (const [out, keys] of Object.entries(aliases)) {
  if (existing.has(out)) continue;
  const key = keys.find(k => secret[k] !== undefined && secret[k] !== null && String(secret[k]).trim());
  if (key) process.stdout.write(out + '\t' + String(secret[key]) + '\n');
}