import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import compression from "compression";
import { tradingRouter } from "./server/trading/routes.js";
import { githubRoutes } from "./server/githubRoutes.js";
import { pushAndDeployAll } from "./server/githubService.js";
import { globalTradingStore } from "./server/trading/store.js";

const app = express();
const PORT = 3000;

// Security & Parsing Middlewares
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Permissive CORS for Multi-Cloud & Local Testing
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.header("Access-Control-Allow-Origin", origin || "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// -------------------- CORE API ROUTES --------------------

// 1. Healthcheck Endpoint (for AWS EC2, Amplify, Load Balancer, and Health Monitors)
app.get("/api/health", (req, res) => {
  const store = globalTradingStore;
  const mem = process.memoryUsage();
  res.json({
    status: "ok",
    service: "Autonomous Crypto Grid Trading Platform",
    version: "v2.5.0",
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

// 2. Autonomous Crypto Grid Trading Platform Router
app.use("/api/trading", tradingRouter);

// 3. GitOps, GitHub Webhooks & CI/CD Deployment Router
app.use("/api/github", githubRoutes);

// 4. On-Demand Deployment Trigger Endpoint
app.post("/api/deploy", async (req, res) => {
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
