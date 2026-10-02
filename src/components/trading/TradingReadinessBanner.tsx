import React, { useEffect, useState } from 'react';
import { fetchTradingReadiness } from '../../services/tradingService';

/**
 * The single, prominent answer to "can this platform trade right now?".
 *
 * It renders the SERVER's verdict verbatim. It deliberately does not compute or soften readiness
 * itself: the platform previously showed a green, healthy system while Bybit was rejecting the API
 * key and execution was latched OFF. Nothing here may ever show green unless the server has
 * positively verified every gate, and an unreachable/unknown state is shown as UNKNOWN rather than
 * defaulted to ready.
 */
type ReadinessSignal = { id: string; ok: boolean; detail: string };
type Readiness = {
  ready: boolean;
  blockers: string[];
  signals: ReadinessSignal[];
  context: { autonomyLevel: number | null; armed: boolean | null; autonomousTradingActive: boolean };
  assessedAt: string;
};

export const TradingReadinessBanner: React.FC = () => {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetchTradingReadiness();
        if (cancelled) return;
        // An absent verdict must NOT read as ready.
        if (!res || typeof res.ready !== 'boolean') {
          setError('Readiness response did not include a verdict.');
          setReadiness(null);
        } else {
          setReadiness(res);
          setError(null);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Readiness could not be fetched.');
        setReadiness(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const timer = setInterval(load, 20000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Three visually distinct states. UNKNOWN is never rendered as green.
  const state: 'ready' | 'blocked' | 'unknown' =
    loading ? 'unknown' : readiness?.ready ? 'ready' : readiness ? 'blocked' : 'unknown';

  const styles = {
    ready: 'bg-emerald-950/60 border-emerald-700 text-emerald-200',
    blocked: 'bg-red-950/60 border-red-700 text-red-200',
    unknown: 'bg-amber-950/50 border-amber-700 text-amber-200',
  }[state];

  const headline = {
    ready: 'TRADING READY',
    blocked: 'TRADING UNAVAILABLE',
    unknown: loading ? 'ASSESSING TRADING READINESS…' : 'TRADING READINESS UNKNOWN',
  }[state];

  return (
    <div className={`rounded-xl border px-4 py-3 ${styles}`} role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold tracking-wide">{headline}</span>
            {readiness && (
              <span className="text-[11px] font-mono opacity-80">
                autonomy {readiness.context.autonomyLevel ?? 'n/a'} · armed {String(readiness.context.armed ?? 'n/a')} ·
                autonomous trading {readiness.context.autonomousTradingActive ? 'active' : 'inactive'}
              </span>
            )}
          </div>

          {state === 'blocked' && readiness && (
            <ul className="text-[12px] font-mono list-disc pl-4 space-y-0.5">
              {readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
          {state === 'ready' && (
            <div className="text-[12px] font-mono opacity-90">
              Every execution gate is verified: credentials accepted, execution engine enabled, no kill switch, not fail-closed.
            </div>
          )}
          {state === 'unknown' && (
            <div className="text-[12px] font-mono opacity-90">
              {error || 'No readiness verdict has been received yet.'}
            </div>
          )}
        </div>

        {readiness && (
          <div className="text-[10px] font-mono opacity-70">
            assessed {new Date(readiness.assessedAt).toLocaleTimeString()}
          </div>
        )}
      </div>

      {readiness && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono opacity-80 border-t border-current/20 pt-2">
          {readiness.signals.map((s) => (
            <span key={s.id} title={s.detail}>
              {s.ok ? '✔' : '✗'} {s.id}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default TradingReadinessBanner;
