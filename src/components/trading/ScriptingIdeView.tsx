import React, { useState } from 'react';
import { Code, Terminal, FileCode, Copy, BookOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import { validateUserScript } from '../../services/tradingService';

export const ScriptingIdeView: React.FC = () => {
  const PRESET_SCRIPTS = {
    ADAPTIVE_ATR: `// Live strategy source contract example
function onTick(ctx) {
  const price = ctx.price();
  const rsi = ctx.rsi();
  const regime = ctx.regime();
  ctx.log("Live tick: $" + price + " | Regime: " + regime + " | RSI: " + rsi);
  // Strategy source may describe signals, but cannot emit orders from this IDE.
}`,
    RSI_MEAN_REVERSION: `// Live RSI research strategy
function onTick(ctx) {
  const rsi = ctx.rsi();
  const position = ctx.position();
  ctx.log("RSI=" + rsi + " | Base inventory=" + position.baseAmount);
  // Deployment is handled by the live strategy engine after validation and risk approval.
}`,
    TREND_PROTECTION: `// Live trend-protection strategy
function onTick(ctx) {
  const price = ctx.price();
  const ema21 = ctx.ema(21);
  const ema50 = ctx.ema(50);
  ctx.log("Price=" + price + " | EMA21=" + ema21 + " | EMA50=" + ema50);
  // No order-emission API is exposed to user source.
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
        error: err?.message || 'Validation request failed'
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
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 shadow-xl">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
            <Code className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Quant Strategy IDE — Live Source Validator</h2>
            <p className="text-[11px] text-slate-400">Validation-only source review. User code is never executed and cannot place orders.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-[11px]">Load Preset:</span>
          {Object.entries(PRESET_SCRIPTS).map(([key, value]) => (
            <button key={key} onClick={() => setCode(value)} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors">
              {key === 'ADAPTIVE_ATR' ? 'Adaptive ATR' : key === 'RSI_MEAN_REVERSION' ? 'RSI Reversion' : 'Trend Shield'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col shadow-2xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2">
              <FileCode className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-200 font-bold">strategy.js (Live Validator)</span>
            </div>
            <button onClick={copyCode} className="hover:text-white flex items-center gap-1">
              <Copy className="w-3 h-3" />
              <span>{copiedNotice ? 'Copied!' : 'Copy'}</span>
            </button>
          </div>

          <textarea
            value={code}
            onChange={e => setCode(e.target.value)}
            rows={17}
            className="w-full flex-1 bg-transparent text-emerald-300 font-mono text-xs focus:outline-none resize-none leading-relaxed p-2"
            spellCheck={false}
          />

          <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Execution disabled · Live deployment remains behind strategy, risk and exchange gates.</span>
            <button
              onClick={handleValidate}
              disabled={isValidating}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold uppercase tracking-wider transition-all font-mono disabled:opacity-50"
            >
              <Code className="w-3.5 h-3.5" />
              <span>{isValidating ? 'Validating...' : 'Validate Live Strategy Source'}</span>
            </button>
          </div>
        </div>

        <div className="space-y-4 flex flex-col">
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex-1 flex flex-col shadow-2xl">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2 mb-2 text-xs font-bold text-white">
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Validation Logs</span>
              {validationResult && <span className="ml-auto text-[10px] font-normal text-slate-400">{validationResult.validationTimeMs}ms</span>}
            </div>
            <div className="flex-1 overflow-y-auto max-h-[260px] bg-black/50 p-2.5 rounded font-mono text-[11px] space-y-1">
              {!validationResult ? (
                <div className="text-slate-600 text-center py-8">Validate source to check the live strategy contract.</div>
              ) : validationResult.error ? (
                <div className="text-rose-400 p-2 bg-rose-950/40 rounded border border-rose-900">
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{validationResult.error}
                </div>
              ) : (
                <>
                  {validationResult.logs.map((log, idx) => (
                    <div key={idx} className="text-slate-300"><span className="text-slate-600 mr-1.5">&gt;</span>{log}</div>
                  ))}
                  <div className="mt-2 pt-2 border-t border-slate-800 text-emerald-300 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Source accepted for non-executable live deployment review.
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs">
            <div className="flex items-center gap-2 font-bold text-white mb-2"><BookOpen className="w-3.5 h-3.5 text-cyan-400" />Live Strategy Contract</div>
            <div className="space-y-1 text-[11px] text-slate-300 font-mono">
              <div><code className="text-cyan-300">onTick(ctx)</code> is required.</div>
              <div>Live telemetry is read-only.</div>
              <div>Order-emission APIs are unavailable.</div>
              <div>Deployment remains subject to live evidence, risk, and exchange gates.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
