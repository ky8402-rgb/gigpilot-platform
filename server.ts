import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cookieParser from "cookie-parser";
import path from "path";
import compression from "compression";
let tradingStore: any = null;
let ownerAuth: { verifyToken: (token: string) => boolean } | null = null;
let pushAndDeployAll: ((options: { commitMessage: string; branch: string; skipAmplify: boolean; skipEc2: boolean }) => Promise<unknown>) | null = null;

const app = express();
const PORT = Number(process.env.PORT || 3000);
app.set('trust proxy', 1);

// Security & Parsing Middlewares
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// Restricted CORS: only the configured frontend and local development origins are accepted.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowed = new Set([
    process.env.FRONTEND_ORIGIN || "https://main.d2qe2q720fbn3x.amplifyapp.com",
    ...configuredOrigins,
    "http://localhost:5173",
    "http://localhost:3000"
  ]);
  if (origin && allowed.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-GitHub-Event, X-GitHub-Delivery, X-Hub-Signature-256");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// -------------------- CORE API ROUTES --------------------

// 1. Healthcheck Endpoint (for AWS EC2, Amplify, Load Balancer, and Health Monitors)
app.get("/api/health", (req, res) => {
  const mem = process.memoryUsage();
  let tradingEngine: Record<string, unknown> = {
    available: false,
    reason: "Trading state unavailable during health probe."
  };

  try {
    const store = tradingStore;
    if (!store) throw new Error("Trading modules are still initializing.");
    tradingEngine = {
      available: true,
      activeSymbol: store.activeSymbol,
      autonomyLevel: store.autonomyLevel,
      tradingMode: store.tradingMode,
      killSwitchActive: store.killSwitch.getState().isActive,
      circuitBreakerActive: store.risk.isCircuitBreakerActive(),
      totalEquityUsd: store.capital.totalEquity,
      netProfitUsd: store.capital.netRealizedProfit,
    };
  } catch (error) {
    console.error("[Health] Trading state probe failed:", error);
  }

  res.status(200).json({
    status: "ok",
    service: "Autonomous Crypto Grid Trading Platform",
    version: "v2.5.0",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    tradingEngine,
    system: {
      nodeVersion: process.version,
      rssMb: Math.round(mem.rss / 1024 / 1024),
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    }
  });
});

// 4. On-Demand Deployment Trigger Endpoint (owner-authenticated)
app.post("/api/deploy", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;
  if (process.env.NODE_ENV === "production" && (!token || !ownerAuth?.verifyToken(token))) {
    return res.status(401).json({ success: false, error: "Owner authentication required." });
  }
  if (!pushAndDeployAll) {
    return res.status(503).json({ success: false, error: "Deployment services are still initializing." });
  }
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

  // Load heavy trading/GitOps modules only after the HTTP listener is bound.
  // This prevents synchronous module initialization from blocking the health endpoint.
  const [tradingModule, githubModule, authModule, githubServiceModule] = await Promise.all([
    import("./server/trading/routes.js"),
    import("./server/githubRoutes.js"),
    import("./server/trading/ownerAuth.js"),
    import("./server/githubService.js"),
  ]);

  tradingStore = (await import("./server/trading/store.js")).globalTradingStore;
  ownerAuth = authModule.ownerAuth;
  pushAndDeployAll = githubServiceModule.pushAndDeployAll;

  app.use("/api/trading", tradingModule.tradingRouter);
  app.use("/api/github", githubModule.githubRoutes);

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

  // Bind the HTTP listener before optional Vite/static SPA setup. This guarantees
  // the API health endpoint is reachable even if frontend middleware configuration
  // fails during startup.
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n===============================================================`);
    console.log(`🚀 Autonomous Crypto Grid Trading Platform running on port ${PORT}`);
    console.log(`📊 Mode: ${process.env.NODE_ENV || "development"} | Bound: 0.0.0.0:${PORT}`);
    console.log(`🌐 Health: http://localhost:${PORT}/api/health`);
    console.log(`📈 Trading State: http://localhost:${PORT}/api/trading/state`);
    console.log(`===============================================================\n`);
  });

  server.on("error", (err) => {
    console.error("[HTTP Server] Failed to bind/listen:", err);
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
