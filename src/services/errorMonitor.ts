import { invalidateApiCache } from "./api";

export interface ReportedError {
  type: string;
  message: string;
  filename?: string;
  line?: number;
  stack?: string;
  timestamp: string;
}

class ErrorMonitor {
  private errors: ReportedError[] = [];
  private recoveryAttempts = 0;
  private maxAttempts = 5;
  private listeners: Set<(err: ReportedError) => void> = new Set();
  private initialized = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.setupErrorHandling();
    }
  }

  public subscribe(listener: (err: ReportedError) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setupErrorHandling() {
    if (this.initialized) return;
    this.initialized = true;

    // 1. Global runtime error handler
    window.addEventListener("error", (event) => {
      this.reportError({
        type: "runtime",
        message: event.message || "Uncaught runtime error",
        filename: event.filename,
        line: event.lineno,
        stack: event.error?.stack,
        timestamp: new Date().toISOString()
      });
    });

    // 2. Unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      this.reportError({
        type: "promise",
        message: typeof reason === "object" ? (reason?.message || JSON.stringify(reason)) : String(reason),
        stack: reason?.stack,
        timestamp: new Date().toISOString()
      });
    });
  }

  public reportError(error: ReportedError) {
    this.errors.push(error);
    if (this.errors.length > 50) this.errors.shift();

    console.warn("🚨 [ErrorMonitor] Exception intercepted:", error.message);

    // Save to local storage cache for diagnostic inspection
    try {
      const existing = JSON.parse(localStorage.getItem("gigpilot_error_logs") || "[]");
      existing.unshift(error);
      localStorage.setItem("gigpilot_error_logs", JSON.stringify(existing.slice(0, 30)));
    } catch {
      // Ignore storage quota errors
    }

    // Send error report to self-healing backend
    try {
      fetch("/api/error/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error, context: this.getContext() })
      }).catch(() => {});
    } catch {
      // Silent telemetry failure
    }

    // Notify listeners
    this.listeners.forEach((cb) => {
      try {
        cb(error);
      } catch {}
    });

    // Attempt automated client recovery
    this.attemptRecovery(error);
  }

  public async attemptRecovery(error: ReportedError) {
    if (this.recoveryAttempts >= this.maxAttempts) {
      console.warn("❌ [ErrorMonitor] Max automated client recoveries reached for current cycle.");
      return;
    }

    this.recoveryAttempts++;
    const msg = error.message.toLowerCase();

    if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) {
      console.log("🔧 [ErrorMonitor] Auto-healing: invalidating stale cache and resynchronizing...");
      invalidateApiCache("all");
    } else if (msg.includes("memory") || msg.includes("quota")) {
      console.log("🔧 [ErrorMonitor] Auto-healing: clearing client memory buffers...");
      invalidateApiCache("all");
    }
  }

  public getContext() {
    if (typeof window === "undefined") return {};
    return {
      url: window.location.href,
      userAgent: navigator.userAgent,
      screen: `${window.innerWidth}x${window.innerHeight}`,
      timestamp: new Date().toISOString()
    };
  }

  public getRecentErrors(): ReportedError[] {
    return this.errors;
  }
}

export const errorMonitor = new ErrorMonitor();
