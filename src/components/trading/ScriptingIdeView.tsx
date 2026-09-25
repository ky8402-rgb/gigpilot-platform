import React, { useState } from 'react';
import {
  Code,
  Play,
  Terminal,
  FileCode,
  Copy,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  RotateCcw
} from 'lucide-react';
import { validateUserScript } from '../../services/tradingService';

export const ScriptingIdeView: React.FC = () => {
  const PRESET_SCRIPTS = {
    ADAPTIVE_ATR: `// Adaptive ATR Dynamic Grid Strategy
function onTick(ctx) {
  const price = ctx.price();
  const rsi = ctx.rsi();
  const regime = ctx.regime();
  
  ctx.log("Tick received: $" + price + " | Regime: " + regime + " | RSI: " + rsi.toFixed(1));

  // If oversold or in range bound, set up geometric grid
  if (regime.includes("RANGE_BOUND") || rsi < 45) {
    const spacing = 0.008; // 0.8% geometric step
    const upper = price * 1.05;
    const lower = price * 0.95;
    
    ctx.log("Configuring 16-level geometric grid between $" + lower.toFixed(0) + " and $" + upper.toFixed(0));
    ctx.place_grid(16, lower, upper, "GEOMETRIC");
  } else if (regime.includes("BEAR")) {
    ctx.log("Bear regime detected: placing defensive limit bids only");
    ctx.buy(0.02, Number((price * 0.96).toFixed(2)));
  }
}`,
    RSI_MEAN_REVERSION: `// RSI Extreme Mean Reversion Ladder
function onTick(ctx) {
  const price = ctx.price();
  const rsi = ctx.rsi();
  const pos = ctx.position();

  ctx.log("Checking RSI mean reversion. Current RSI: " + rsi.toFixed(2));

  if (rsi < 30) {
    // Extreme oversold - ladder 3 scale-in buy orders
    ctx.log("Oversold signal triggered (RSI < 30). Placing scale-in bids...");
    ctx.buy(0.015, Number((price * 0.995).toFixed(2)));
    ctx.buy(0.025, Number((price * 0.985).toFixed(2)));
    ctx.buy(0.035, Number((price * 0.975).toFixed(2)));
  } else if (rsi > 70 && pos.baseAmount > 0) {
    // Overbought - take profit on inventory
    ctx.log("Overbought signal triggered (RSI > 70). Taking partial profit...");
    ctx.sell(Math.min(pos.baseAmount, 0.03), Number((price * 1.005).toFixed(2)));
  }
}`,
    TREND_PROTECTION: `// Trend-Protected Grid with Volatility Multiplier
function onTick(ctx) {
  const price = ctx.price();
  const ema21 = ctx.ema(21);
  const ema50 = ctx.ema(50);
  const bb = ctx.bb();

  ctx.log("EMA21: " + ema21.toFixed(1) + " | EMA50: " + ema50.toFixed(1) + " | BB Bandwidth: " + bb.bandwidth.toFixed(2) + "%");

  // Only deploy full grid if market is not in violent trend
  if (Math.abs(ema21 - ema50) / price < 0.02) {
    ctx.place_grid(20, price * 0.94, price * 1.06, "GEOMETRIC");
    ctx.log("Trend filter neutral. Full 20-rung grid active.");
  } else {
    ctx.log("Trend filter engaged: Wider defensive boundaries applied.");
    ctx.place_grid(12, price * 0.90, price * 1.08, "GEOMETRIC");
  }
}`
  };

  const [code, setCode] = useState(PRESET_SCRIPTS.ADAPTIVE_ATR);
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    logs: string[];
    validationTimeMs: number;
    executable: false;
    error?: string;
  } | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const handleValidate = async () => {
    setIsValidating(true);
    setValidationResult(null);
    try {
      const res = await validateUserScript(code);
      setValidationResult(res.result);
    } catch (err: any) {
      setValidationResult({
        success: false,
        logs: [],
        validationTimeMs: 0,
        executable: false,
        error: err.message || 'Validation request failed'
      });
    } finally {
      setIsValidating(false);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 2000);
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto font-mono text-xs">
      {/* Header & Preset Selector */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
            <Code className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Quant Strategy IDE — Live Source Validator
            </h2>
            <p className="text-[11px] text-slate-400">
              Validation-only source review; no user-code execution or simulated orders
            </p>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[11px]">Load Preset:</span>
          <button
            onClick={() => setCode(PRESET_SCRIPTS.ADAPTIVE_ATR)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Adaptive ATR
          </button>
          <button
            onClick={() => setCode(PRESET_SCRIPTS.RSI_MEAN_REVERSION)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            RSI Reversion
          </button>
          <button
            onClick={() => setCode(PRESET_SCRIPTS.TREND_PROTECTION)}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
          >
            Trend Shield
          </button>
        </div>
      </div>

      {/* Editor & Console Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Code Editor */}
        <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-200 font-bold">strategy.js (Live Validator)</span>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={copyCode} className="hover:text-white flex items-center gap-1">
                <Copy className="w-3 h-3" />
                <span>{copiedNotice ? 'Copied!' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            rows={17}
            className="w-full flex-1 bg-transparent text-emerald-300 font-mono text-xs focus:outline-none resize-none leading-relaxed p-2 selection:bg-emerald-800 selection:text-white"
            spellCheck={false}
          />

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              Execution disabled · Live deployment remains behind strategy, risk and exchange gates
            </span>
            <button
              onClick={handleValidate}
              disabled={isValidating}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold uppercase tracking-wider shadow-lg shadow-emerald-600/30 transition-all font-mono"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>{isRunning ? 'Validating...' : 'Validate Live Strategy Source'}</span>
            </button>
          </div>
        </div>

        {/* Execution Output & CTX Docs */}
        <div className="space-y-4 flex flex-col">
          {/* Console Output */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex-1 flex flex-col shadow-2xl">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2 mb-2 text-xs font-bold text-white">
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Validation Logs</span>
              {validationResult && (
                <span className="ml-auto text-[10px] font-normal text-slate-400">
                  {!validationResult.executable && (
                    <div className="mt-2 pt-2 border-t border-slate-800 text-slate-400">Source validation never executes code or generates orders.</div>
                  )}validationTimeMs}ms
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto max-h-[220px] bg-black/50 p-2.5 rounded font-mono text-[11px] space-y-1 custom-scrollbar">
              {!validationResult ? (
                <div className="text-slate-600 text-center py-8">
                  Hit "Validate Live Strategy Source" to verify the live strategy source contract.
                </div>
              ) : validationResult.error ? (
                <div className="text-rose-400 p-2 bg-rose-950/40 rounded border border-rose-900">
                  Error: {validationResult.error}
                </div>
              ) : (
                <>
                  {validationResult.logs.map((log, idx) => (
                    <div key={idx} className="text-slate-300">
                      <span className="text-slate-600 mr-1.5">&gt;</span>
                      <span>{log}</span>
                    </div>
                  ))}
                  {validationResult.
                </>
              )}
            </div>
          </div>

          {/* Context Reference Sheet */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-white mb-2">
              <BookOpen className="w-3.5 h-3.5 text-cyan-400" />
              <span>Live Strategy Contract</span>
            </div>
            <div className="space-y-1 text-[11px] text-slate-300 font-mono">
              <div><code className="text-cyan-300">ctx.price()</code> : Current market price</div>
              <div><code className="text-cyan-300">ctx.rsi(period=14)</code> : Relative Strength Index</div>
              <div><code className="text-cyan-300">ctx.regime()</code> : Detected regime string</div>
                            <div><code className="text-cyan-300">live-source logging contract</code> : Print output to console</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
