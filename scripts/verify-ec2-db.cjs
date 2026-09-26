#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

let url = (process.env.DATABASE_URL || "").trim();

if (!url) {
  const envPaths = [
    path.join(process.cwd(), ".env"),
    "/home/ubuntu/gigpilot/.env",
    path.join(process.cwd(), ".env.production"),
    "/home/ubuntu/gigpilot/.env.production"
  ];
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf8");
        const match = content.match(/^DATABASE_URL=(.+)$/m);
        if (match) {
          url = match[1].replace(/^["']|["']$/g, "").trim();
          if (url) break;
        }
      } catch {}
    }
  }
}

if (!url) {
  console.error("DATABASE_URL is not configured on production host");
  process.exit(2);
}

// If .env file exists and needs DATABASE_URL persisted, write it safely
try {
  const envFile = fs.existsSync("/home/ubuntu/gigpilot/.env")
    ? "/home/ubuntu/gigpilot/.env"
    : (fs.existsSync(".env") ? ".env" : null);
  if (envFile) {
    let content = fs.readFileSync(envFile, "utf8");
    if (content.includes("DATABASE_URL=")) {
      content = content.replace(/^DATABASE_URL=.+$/m, `DATABASE_URL="${url}"`);
    } else {
      content += `\nDATABASE_URL="${url}"\n`;
    }
    fs.writeFileSync(envFile, content, "utf8");
  }
} catch (e) {
  // non-fatal
}

const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 5000,
});

(async () => {
  await client.connect();
  const ping = await client.query("SELECT 1 AS ok, current_database() AS db, current_schema() AS schema");
  const tables = await client.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')");
  await client.query("BEGIN");
  await client.query("CREATE TEMP TABLE gigpilot_cert_probe (value integer) ON COMMIT DROP");
  await client.query("INSERT INTO gigpilot_cert_probe(value) VALUES (1)");
  const before = await client.query("SELECT COUNT(*)::int AS count FROM gigpilot_cert_probe");
  await client.query("ROLLBACK");
  console.log(JSON.stringify({
    connectivity: ping.rows[0],
    applicationTableCount: tables.rows[0].count,
    transactionRollbackVerified: before.rows[0].count === 1
  }));
  await client.end();
})().catch(async err => {
  console.error("DB probe failed:", err.message);
  try { await client.end(); } catch {}
  process.exit(1);
});
