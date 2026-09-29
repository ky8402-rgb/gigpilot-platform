import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import compression from "compression";
import { tradingRouter } from "./server/trading/routes.js";
import { githubRoutes } from "./server/githubRoutes.js";
import { pushAndDeployAll } from "./server/githubService.js";
import { globalTradingStore } from "./server/trading/store.js";
import { requireOwnerAuth } from "./server/trading/ownerAuth.js";

const app = express();
const PORT = 3000;

// Security & Parsing Middlewares
app.use(compression());
// Capture the exact received bytes in addition to the parsed body: GitHub HMAC-SHA256
// signatures are computed over the raw payload, so re-serializing the parsed object
// breaks verification (key order / escaping / unicode differences).
app.use(express.json({
  limit: "10mb",
  verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Strict CORS Origin Validation (Protects against reflected origin CSRF)
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // Direct server-to-server, curl, CLI
  try {
    const url = new URL(origin);
    const host = url.hostname;
    // Allow local development ports
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;

    // Explicit allowlist always applies, and is the ONLY thing that applies in strict mode.
    const customList = (process.env.CORS_ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (customList.includes(origin.toLowerCase()) || customList.includes(host.toLowerCase())) return true;

    // CORS_STRICT=true confines CORS to CORS_ALLOWED_ORIGINS above. Off by default, because the
    // suffix domains below are shared: any AWS customer can create an Amplify app, any GCP project
    // can run on *.run.app, and sslip.io hands out subdomains on request, so "trusted origin" is
    // effectively "anyone with a cloud account". Severity stays bounded because the owner token is
    // header-only (never sent automatically by a browser), so a foreign origin still cannot make an
    // authenticated call without already holding the token. Turn strict mode on once the real
    // production origins are known and listed.
    if (process.env.CORS_STRICT === 'true') return false;

    // Allow AWS Amplify production and branch domains
    if (host.endsWith('.amplifyapp.com')) return true;
    // Allow Google Cloud Run and Google preview domains
    if (host.endsWith('.run.app') || host.endsWith('.googleusercontent.com')) return true;
    // Allow dynamic EC2 IP DNS domains
    if (host.endsWith('.sslip.io')) return true;

    return false;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
    } else {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256, X-Owner-Token");
  } else {
    // Untrusted cross-origin request: disallow credentials and set null origin
    res.header("Access-Control-Allow-Origin", "null");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// -------------------- CORE API ROUTES --------------------

// 1a. Lightweight liveness ping (used by healthcheck.js, Docker HEALTHCHECK, and EC2 diagnostics).
// Kept intentionally minimal so health monitors never depend on store I/O.
app.get("/api/health/ping", (req, res) => {
  res.json({ success: true, status: "ok", timestamp: new Date().toISOString() });
});

// 1b. Healthcheck Endpoint (for AWS EC2, Amplify, Load Balancer, and Health Monitors)
app.get("/api/health", (req, res) => {
  const store = globalTradingStore;
  const mem = process.memoryUsage();
  const deployedCommitPath = process.env.GIGPILOT_DEPLOYED_COMMIT_FILE || path.join(process.cwd(), ".gigpilot-data", "deployed-commit.txt");
  let deployedCommit: string | null = null;
  try {
    const value = fs.readFileSync(deployedCommitPath, "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(value)) deployedCommit = value;
  } catch {
    deployedCommit = null;
  }

  if (!deployedCommit) {
    if (process.env.DEPLOYED_COMMIT && /^[0-9a-f]{40}$/i.test(process.env.DEPLOYED_COMMIT.trim())) {
      deployedCommit = process.env.DEPLOYED_COMMIT.trim();
    } else if (process.env.GITHUB_SHA && /^[0-9a-f]{40}$/i.test(process.env.GITHUB_SHA.trim())) {
      deployedCommit = process.env.GITHUB_SHA.trim();
    } else {
      try {
        const { execSync } = require("child_process");
        const gitSha = execSync("git rev-parse HEAD", { timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        if (/^[0-9a-f]{40}$/i.test(gitSha)) deployedCommit = gitSha;
      } catch {}
    }
  }
  res.json({
    status: "ok",
    service: "Autonomous Crypto Grid Trading Platform",
    version: "v2.5.0",
    deployedCommit,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    tradingEngine: {
      activeSymbol: store.activeSymbol,
      autonomyLevel: store.autonomyLevel,
      tradingMode: store.tradingMode,
      killSwitchActive: store.killSwitch.getState().isActive,
      circuitBreakerActive: store.risk.isCircuitBreakerActive(),
      totalEquityUsd: store.capital.totalEquity,
      netProfitUsd: store.capital.netRealizedProfit,
    },
    system: {
      nodeVersion: process.version,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    }
  });
});

/**
 * Readiness probe. Complements /api/health (liveness) with a judgement about whether this instance
 * could actually trade right now, and is the signal the deploy pipeline gates a rollback on.
 *
 * Deliberately reports only booleans, ages and counts — no balances, thresholds, symbols held or
 * credentials — because it is intentionally reachable unauthenticated for monitoring.
 *
 * Always returns HTTP 200 with a `status` field. "not_ready" is a legitimate steady state for a
 * platform whose kill switch, reserve and funding requirements are deliberately fail-closed;
 * returning an HTTP error would make monitoring and the deploy gate report a false outage.
 */
app.get("/api/health/ready", (req, res) => {
  const store = globalTradingStore;
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  // 1. Market data freshness: a live price plus a recently closed candle.
  let pairData: any = null;
  try {
    pairData = store.dataEngine.getPairData(store.activeSymbol);
  } catch {
    pairData = null;
  }
  const candles = Array.isArray(pairData?.candles) ? pairData.candles : [];
  const latestCandleTs = candles.length > 0 ? Number(candles[candles.length - 1]?.timestamp) || 0 : 0;
  const candleAgeMs = latestCandleTs > 0 ? Date.now() - (latestCandleTs + 60_000) : Number.POSITIVE_INFINITY;
  const hasLivePrice = Number(pairData?.currentPrice) > 0;
  checks.marketData = {
    ok: hasLivePrice && candleAgeMs < 5 * 60_000,
    detail: hasLivePrice
      ? `live price present; latest closed candle ${Number.isFinite(candleAgeMs) ? `${Math.round(candleAgeMs / 1000)}s old` : "unavailable"}`
      : "no live price yet"
  };

  // 2. Engine fleet health and the fail-closed gate.
  let failClosed = { failClosed: true, downEngines: ["UNKNOWN"] as string[] };
  let engineCount = 0;
  let unhealthyEngines = 0;
  try {
    failClosed = store.monitor.isSystemFailClosed();
    const engines = store.monitor.getAllEngineHealth();
    engineCount = engines.length;
    unhealthyEngines = engines.filter(e => e.status !== "HEALTHY").length;
  } catch {
    /* leave the fail-closed default above */
  }
  checks.engines = {
    ok: !failClosed.failClosed,
    detail: failClosed.failClosed
      ? `fail-closed: ${failClosed.downEngines.join(", ")}`
      : `${engineCount} engines registered, ${unhealthyEngines} not ONLINE`
  };

  // 3. Hard halt and kill-switch posture (reported as state, not as a failure: halting is healthy).
  const halted = store.exchangeExec.isHalted();
  const killSwitchActive = store.killSwitch.getState().isActive;
  checks.safetyInterlocks = {
    ok: true,
    detail: `halt=${halted ? "engaged" : "released"} killSwitch=${killSwitchActive ? "active" : "inactive"}`
  };

  // 4. Capital availability for trading, without disclosing any figure.
  let capitalAllocatable = false;
  try {
    const riskConfig = store.risk.getConfig();
    const availableCash = Number(store.capital.availableCash || 0);
    capitalAllocatable = Math.min(availableCash - riskConfig.minAccountReserveUsd, availableCash * (riskConfig.maxCapitalAllocationPct / 100)) > 0;
  } catch {
    capitalAllocatable = false;
  }
  checks.capital = {
    // Reported for observability only: having no allocatable capital is a funding condition, not a
    // service fault, so it must never make the instance look unready.
    ok: true,
    detail: capitalAllocatable
      ? "allocatable capital available"
      : "no allocatable capital (reserve or allocation cap); trading correctly blocked"
  };

  // 5. Durable state must be writable, or realized P&L would be lost on the next restart.
  let persistenceOk = false;
  try {
    persistenceOk = store.flushTradingState();
  } catch {
    persistenceOk = false;
  }
  checks.persistence = {
    ok: persistenceOk,
    detail: persistenceOk ? "durable trading state writable" : "durable trading state could NOT be written"
  };

  // Ready = the process is live, market data is flowing and the engine fleet is not fail-closed.
  // Safety interlocks and capital are intentionally excluded from this judgement.
  const ready = checks.marketData.ok && checks.engines.ok && checks.persistence.ok;

  res.json({
    status: ready ? "ready" : "not_ready",
    ready,
    activelyTrading: !halted && !killSwitchActive,
    checks,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// 2. Autonomous Crypto Grid Trading Platform Router
app.use("/api/trading", tradingRouter);

// Authentication Route Aliases (Ensures all variations like /api/auth/login and /auth/login guarantee JSON responses)
app.use("/api/auth", tradingRouter);
app.use("/auth", tradingRouter);

// 3. GitOps, GitHub Webhooks & CI/CD Deployment Router
app.use("/api/github", githubRoutes);

// 4. On-Demand Deployment Trigger Endpoint
app.post("/api/deploy", requireOwnerAuth, async (req, res) => {
  try {
    const { commitMessage, branch, skipAmplify, skipEc2 } = req.body || {};
    const result = await pushAndDeployAll({
      commitMessage: commitMessage || `chore: automated production sync [${new Date().toISOString()}]`,
      branch: branch || "main",
      skipAmplify: Boolean(skipAmplify),
      skipEc2: Boolean(skipEc2)
    });
    res.json(result);
  } catch (err: any) {
    console.error("[Deploy Endpoint Error]:", err);
    res.status(500).json({ success: false, error: err.message || "Deployment failed" });
  }
});

// 5. Automated EC2 Provisioning Script Distribution Endpoint (Secured: Owner Auth Required)
app.get(["/setup-ec2.sh", "/scripts/setup-ec2.sh"], requireOwnerAuth, (req, res) => {
  const rootDir = process.cwd();
  const candidates = [
    path.join(rootDir, "public", "setup-ec2.sh"),
    path.join(rootDir, "scripts", "setup-ec2.sh"),
    path.join(rootDir, "setup-ec2.sh")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(candidate);
    }
  }
  return res.status(404).send("#!/bin/bash\necho 'Error: setup-ec2.sh not found'\nexit 1\n");
});

// -------------------- SERVER INITIALIZATION & VITE MIDDLEWARE --------------------

async function startServer() {
  const isCjsBundle = typeof __filename !== "undefined" && __filename.endsWith(".cjs");
  const isProduction = process.env.NODE_ENV === "production" || isCjsBundle;

  // Guard: Ensure /api requests never leak into Vite SPA fallback HTML
  app.all("/api/*", (req, res) => {
    res.status(404).json({
      success: false,
      error: `API route ${req.method} ${req.originalUrl} not found`
    });
  });

  // Global API error handler ensuring JSON is always returned.
  // tradingRouter is mounted on three prefixes ("/api/trading", "/api/auth", "/auth"), so scoping
  // this to "/api" alone left any error raised on the "/auth" aliases to fall through to Express's
  // default HTML error page. Register it on every mount prefix so the JSON contract holds everywhere.
  for (const prefix of ["/api", "/auth"]) {
    app.use(prefix, (err: any, req: any, res: any, next: any) => {
      console.error(`[API Error] ${req.method} ${req.url}:`, err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message || "Internal Server Error"
      });
    });
  }

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import("vite");
      const isHmrDisabled = process.env.DISABLE_HMR === "true";
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: isHmrDisabled ? false : undefined,
        },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.warn("⚠️ Vite middleware could not be loaded dynamically (production/bundled mode):", viteErr);
    }
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n===============================================================`);
    console.log(`🚀 Autonomous Crypto Grid Trading Platform running on port ${PORT}`);
    console.log(`📊 Mode: ${process.env.NODE_ENV || "development"} | Bound: 0.0.0.0:${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/api/health`);
    console.log(`📈 Trading State: http://localhost:${PORT}/api/trading/state`);
    console.log(`===============================================================\n`);
  });
}

// Global Exception Handlers
process.on("uncaughtException", (err) => {
  console.error("[Trading Platform Error] Uncaught Exception:", err);
  try { flushDurableState(); } catch { /* best effort */ }
});
process.on("unhandledRejection", (reason) => {
  console.error("[Trading Platform Error] Unhandled Rejection:", reason);
});

/**
 * Deploys and restarts deliver SIGTERM/SIGINT. Flushing here means realized P&L, FIFO lots and the
 * measured fills gathered since the last debounced write are not lost on the way down.
 */
function flushDurableState(): void {
  try {
    const ok = globalTradingStore.flushTradingState();
    console.log(`[shutdown] Durable trading state flush: ${ok ? "ok" : "skipped"}`);
  } catch (err: any) {
    console.error(`[shutdown] Durable trading state flush failed: ${err?.message || err}`);
  }
}

process.on("SIGTERM", () => {
  flushDurableState();
  process.exit(0);
});
process.on("SIGINT", () => {
  flushDurableState();
  process.exit(0);
});

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
