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
import { corsMiddleware } from "./server/corsConfig.js";
import { futuresUniverseHandler } from "./server/trading/futuresUniverse.js";

// -------------------- AUTONOMOUS ENGINE HEALTH --------------------
// Measured, never assumed. The Python engine is probed on each health request so a
// crash-looping engine can never be reported as healthy. Bounded and fully guarded so this
// endpoint stays fast and never throws for load balancers / external monitors.
const AUTONOMOUS_ENGINE_URL = process.env.GIGPILOT_URL || "http://127.0.0.1:8001";

type AutonomousEngineHealth = {
  reachable: boolean;
  status: "healthy" | "unhealthy" | "unreachable";
  latencyMs: number;
  httpStatus: number | null;
  armed: boolean | null;
  publicWs: boolean | null;
  privateWs: boolean | null;
  feedFresh: boolean | null;
  positionMode: string | null;
  error: string | null;
};

async function probeAutonomousEngine(): Promise<AutonomousEngineHealth> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${AUTONOMOUS_ENGINE_URL}/health`, { signal: controller.signal });
    const latencyMs = Date.now() - started;
    let body: any = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!body || typeof body !== "object") {
      return {
        reachable: true, status: "unhealthy", latencyMs, httpStatus: response.status,
        armed: null, publicWs: null, privateWs: null, feedFresh: null, positionMode: null,
        error: "malformed_engine_health_body",
      };
    }
    // The engine answers 503 with healthy:false when its own feed is stale or a socket is down.
    const healthy = response.status === 200 && body.healthy === true;
    return {
      reachable: true,
      status: healthy ? "healthy" : "unhealthy",
      latencyMs,
      httpStatus: response.status,
      armed: typeof body.armed === "boolean" ? body.armed : null,
      publicWs: typeof body.public_ws === "boolean" ? body.public_ws : null,
      privateWs: typeof body.private_ws === "boolean" ? body.private_ws : null,
      feedFresh: typeof body.feed_fresh === "boolean" ? body.feed_fresh : null,
      positionMode: typeof body.position_mode === "string" ? body.position_mode : null,
      error: healthy ? null : "engine_reported_unhealthy",
    };
  } catch (err: any) {
    return {
      reachable: false, status: "unreachable", latencyMs: Date.now() - started, httpStatus: null,
      armed: null, publicWs: null, privateWs: null, feedFresh: null, positionMode: null,
      error: err?.name === "AbortError" ? "engine_health_timeout" : (err?.message || "engine_unreachable"),
    };
  } finally {
    clearTimeout(timer);
  }
}

const app = express();
const PORT = 3000;

// Security & Parsing Middlewares
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Strict CORS Origin Validation with CORS_STRICT Support
app.use(corsMiddleware);

// -------------------- CORE API ROUTES --------------------

// 1. Healthcheck Endpoint (for AWS EC2, Amplify, Load Balancer, and Health Monitors)
app.get("/api/health", async (req, res) => {
  const store = globalTradingStore;
  const autonomousEngine = await probeAutonomousEngine();
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
    // Aggregate flag so monitors and the deploy gate can treat a down engine as a failure.
    degraded: autonomousEngine.status !== "healthy",
    autonomousEngine,
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

// 2. Autonomous Crypto Grid Trading Platform Router
app.use("/api/trading", tradingRouter);
app.get("/api/trading/futures/universe", requireOwnerAuth, futuresUniverseHandler);

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

  // Global API error handler ensuring JSON is always returned
  app.use("/api", (err: any, req: any, res: any, next: any) => {
    console.error(`[API Error] ${req.method} ${req.url}:`, err);
    res.status(err.status || 500).json({
      success: false,
      error: err.message || "Internal Server Error"
    });
  });

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
});
process.on("unhandledRejection", (reason) => {
  console.error("[Trading Platform Error] Unhandled Rejection:", reason);
});

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
