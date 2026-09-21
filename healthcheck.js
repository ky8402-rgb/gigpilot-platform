#!/usr/bin/env bash
set -euo pipefail

# Health probe used by local/PM2/AWS checks. The application exposes /api/health.
PORT="${PORT:-3000}"
node -e '
const http = require("http");
const port = Number(process.env.PORT || 3000);
const req = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 5000 }, res => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", chunk => { body += chunk; });
  res.on("end", () => {
    if (res.statusCode === 200) process.exit(0);
    console.error(`Healthcheck failed with status ${res.statusCode}: ${body.slice(0, 500)}`);
    process.exit(1);
  });
});
req.on("timeout", () => { console.error("Healthcheck timed out after 5000ms"); req.destroy(); });
req.on("error", err => { console.error(`Healthcheck network error: ${err.message}`); process.exit(1); });
'