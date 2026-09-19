import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  title?: string;
  onRetry?: () => void;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/** Prevent a lazy-loaded dashboard tool from taking down the whole SPA. */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : 'Unexpected component error',
    };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error('[GigPilot UI] Component crashed:', error, info);
  }

  handleRetry = () => {
    this.setState({ hasError: false, message: '' });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-6 text-slate-200">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-amber-400 text-xl">⚠️</div>
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-white">{this.props.title || 'This tool could not be loaded'}</h3>
            <p className="mt-1 text-sm text-slate-400">
              The rest of GigPilot is still running. The tool was isolated so one UI failure cannot crash the dashboard.
            </p>
            {this.state.message && (
              <p className="mt-2 break-words text-xs font-mono text-amber-300/80">{this.state.message}</p>
            )}
            <button
              type="button"
              onClick={this.handleRetry}
              className="mt-4 rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-amber-200 border border-amber-500/30 hover:bg-amber-500/25"
            >
              Reload Tool
            </button>
          </div>
        </div>
      </div>
    );
  }
}
