import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, Terminal, ShieldAlert, Copy, Check } from 'lucide-react';

export interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    };
  }

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('🚨 [GigPilot ErrorBoundary] Uncaught runtime crash detected:', error);
    console.error('Component Stack Trace:', errorInfo.componentStack);

    // Record crash details in sessionStorage for diagnostic persistence
    try {
      const crashLog = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        url: window.location.href,
        userAgent: navigator.userAgent
      };
      sessionStorage.setItem('gigpilot_last_runtime_crash', JSON.stringify(crashLog));
    } catch (e) {
      // Storage errors shouldn't crash the error handler
    }
  }

  private handleResetApp = (): void => {
    try {
      // Clear potentially corrupted session state
      sessionStorage.removeItem('gigpilot_last_runtime_crash');
      this.setState({ hasError: false, error: null, errorInfo: null });
      // Hard refresh to reinitialize application state cleanly
      window.location.reload();
    } catch (e) {
      window.location.href = window.location.origin;
    }
  };

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  private handleCopyError = (): void => {
    const { error, errorInfo } = this.state;
    const fullLog = `[GigPilot Runtime Error]\nTimestamp: ${new Date().toISOString()}\nError: ${error?.name}: ${error?.message}\n\nStack:\n${error?.stack}\n\nComponent Stack:\n${errorInfo?.componentStack}`;
    
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullLog).then(() => {
        this.setState({ copied: true });
        setTimeout(() => this.setState({ copied: false }), 2500);
      });
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errorMessage = this.state.error?.message || 'An unexpected application runtime error occurred.';
      const componentStack = this.state.errorInfo?.componentStack || '';

      return (
        <div 
          id="error-boundary-screen"
          className="min-h-screen w-full bg-slate-950 text-slate-100 flex items-center justify-center p-4 sm:p-6"
        >
          <div className="w-full max-w-2xl rounded-2xl border border-red-500/30 bg-slate-900/95 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
            {/* Header / Icon */}
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 shadow-inner">
                <ShieldAlert className="h-6 w-6 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-white tracking-tight sm:text-2xl">
                    Application Error Encountered
                  </h1>
                  <span className="rounded-full bg-red-500/10 border border-red-500/30 px-2.5 py-0.5 text-xs font-semibold text-red-400">
                    Crash Guard Active
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  GigPilot prevented a total UI crash and safely captured the exception context.
                </p>
              </div>
            </div>

            {/* Error Message Box */}
            <div className="mt-6 rounded-xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="flex items-center justify-between gap-2 text-xs font-semibold text-red-400 pb-2 border-b border-slate-800/80">
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Exception Message
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
              <div className="mt-2.5 font-mono text-xs text-red-300 break-words leading-relaxed">
                {errorMessage}
              </div>
            </div>

            {/* Technical Stack Trace Accordion */}
            {componentStack && (
              <details className="mt-4 group rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5 text-xs">
                <summary className="flex items-center justify-between cursor-pointer text-slate-400 hover:text-slate-200 transition-colors font-medium">
                  <span className="flex items-center gap-1.5">
                    <Terminal className="h-3.5 w-3.5 text-cyan-400" />
                    View Technical Component Stack
                  </span>
                  <span className="text-[11px] text-slate-500 group-open:rotate-180 transition-transform">
                    ▼
                  </span>
                </summary>
                <div className="mt-3 relative">
                  <pre className="max-h-48 overflow-y-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed border border-slate-900">
                    {componentStack.trim()}
                  </pre>
                  <button
                    id="btn-copy-error-stack"
                    onClick={this.handleCopyError}
                    className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-slate-800/90 hover:bg-slate-700 px-2 py-1 text-[10px] font-semibold text-slate-200 border border-slate-700 transition-all cursor-pointer"
                    title="Copy error trace to clipboard"
                  >
                    {this.state.copied ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-slate-400" />
                        <span>Copy Trace</span>
                      </>
                    )}
                  </button>
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-800">
              <button
                id="btn-try-again"
                onClick={this.handleTryAgain}
                className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700/90 px-4 py-2.5 text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                <RefreshCw className="h-4 w-4 text-cyan-400" />
                Try Re-rendering View
              </button>

              <button
                id="btn-reset-app"
                onClick={this.handleResetApp}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 px-5 py-2.5 text-xs font-bold text-white shadow-lg shadow-red-500/20 transition-all cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                Reset App & Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
