import React, { useCallback, useEffect, useState } from 'react';
import {
  FlaskConical,
  Trophy,
  Swords,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  SearchX,
  Database,
  Clock,
  ShieldCheck,
  ShieldAlert,
  Gauge,
  Hash,
  Layers,
  Microscope
} from 'lucide-react';
import {
  fetchMLTournamentLatest,
  MLTournament,
  MLTournamentCandidate,
  MLTournamentGates,
  MLTournamentResponse
} from '../../services/tradingService';

/* ------------------------------------------------------------------ */
/* Formatting — a missing number renders as an em-dash, never as 0.    */
/* ------------------------------------------------------------------ */

const num = (v: number | null | undefined, dp = 2): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(dp) : '—';

const int = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : '—';

function formatDuration(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(2)} s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function formatTs(ms?: number | null): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '—';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return '—';
  }
}

/* ------------------------------------------------------------------ */
/* Gate definitions — thresholds ALWAYS come from the payload; only    */
/* the label and the champion field each gate is measured against are  */
/* declared here.                                                      */
/* ------------------------------------------------------------------ */

interface GateDef {
  key: keyof MLTournamentGates;
  label: string;
  championField: keyof MLTournamentCandidate;
  unit: string;
  hint: string;
}

const GATE_DEFS: GateDef[] = [
  { key: 'min_net_edge_bps', label: 'Min net edge', championField: 'net_edge_bps', unit: 'bps', hint: 'Net of fees, spread and modelled impact' },
  { key: 'min_oos_sharpe', label: 'Min OOS Sharpe', championField: 'oos_sharpe', unit: '', hint: 'Out-of-sample risk-adjusted return' },
  { key: 'min_profit_factor', label: 'Min profit factor', championField: 'profit_factor', unit: 'x', hint: 'Gross wins ÷ gross losses' },
  { key: 'min_t_stat', label: 'Min t-stat', championField: 't_stat', unit: '', hint: 'Statistical significance of the edge' },
  { key: 'min_walk_forward_folds', label: 'Min walk-forward folds', championField: 'folds', unit: '', hint: 'Independent out-of-sample folds' },
  { key: 'min_oos_trades', label: 'Min OOS trades', championField: 'oos_trades', unit: '', hint: 'Evidence count the edge rests on' }
];

/* Static Tailwind class strings only (no dynamic class construction). */
const TONE = {
  emerald: {
    box: 'bg-emerald-950/50 border-emerald-600/60',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
  },
  cyan: {
    box: 'bg-cyan-950/40 border-cyan-700/60',
    text: 'text-cyan-300',
    chip: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
  },
  slate: {
    box: 'bg-slate-900 border-slate-700',
    text: 'text-slate-300',
    chip: 'bg-slate-800 text-slate-300 border border-slate-600'
  },
  amber: {
    box: 'bg-amber-950/40 border-amber-600/60',
    text: 'text-amber-300',
    chip: 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
  },
  rose: {
    box: 'bg-rose-950/40 border-rose-700/60',
    text: 'text-rose-300',
    chip: 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
  }
} as const;

interface MLResearchAuditLogProps {
  activeSymbol?: string;
  onRefresh?: () => void;
}

export const MLResearchAuditLog: React.FC<MLResearchAuditLogProps> = ({
  activeSymbol = 'BTCUSDT',
  onRefresh
}) => {
  const [data, setData] = useState<MLTournamentResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchMLTournamentLatest(activeSymbol);
      setData(res);
      setError(null);
      setFetchedAt(new Date().toISOString());
    } catch (err: any) {
      // A failed fetch is NOT "no tournament has run" — it is "we could not read the record".
      setError(err?.message || 'Tournament telemetry unavailable.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [activeSymbol]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const tournament: MLTournament | null = data?.tournament ?? null;

  const outcomeView = (t: MLTournament) => {
    switch (t.outcome) {
      case 'CHALLENGER_PROMOTED_TO_PAPER':
        return {
          tone: 'emerald' as const,
          icon: <Trophy className="w-5 h-5 text-emerald-400" />,
          label: 'CHALLENGER PROMOTED TO PAPER',
          blurb: 'A candidate cleared every gate and was promoted for paper evaluation. No live capital was committed automatically.'
        };
      case 'CHAMPION_HELD':
        return {
          tone: 'cyan' as const,
          icon: <ShieldCheck className="w-5 h-5 text-cyan-400" />,
          label: 'CHAMPION HELD',
          blurb: 'A candidate cleared the gates but was not promoted; the incumbent champion remains in place.'
        };
      case 'NO_CANDIDATE_CLEARED_GATES':
      default:
        return {
          tone: 'slate' as const,
          icon: <SearchX className="w-5 h-5 text-slate-400" />,
          label: 'NO CANDIDATE CLEARED GATES',
          blurb:
            'The search found nothing that survived every net-edge gate. This is the expected, valid outcome — not an error, and no model was found or promoted.'
        };
    }
  };

  const realCapitalBadge = () => {
    const v = data?.real_capital_execution;
    if (v === true) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
          <ShieldAlert className="w-3 h-3" /> REAL CAPITAL EXECUTION
        </span>
      );
    }
    if (v === false) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
          <ShieldCheck className="w-3 h-3" /> PAPER — NO REAL CAPITAL
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-600">
        REAL CAPITAL: NOT REPORTED
      </span>
    );
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-mono text-xs">
      {/* Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <FlaskConical className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">ML Research &amp; Audit Log</h2>
                {realCapitalBadge()}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Live champion / challenger tournament over real market bars, gated on net edge after fees, spread and impact
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right text-[11px] text-slate-500 hidden sm:block">
              <div className="flex items-center gap-1.5 justify-end">
                <Swords className="w-3.5 h-3.5 text-slate-400" />
                <span>Symbol: <span className="text-slate-300">{activeSymbol}</span></span>
              </div>
              <div>Last checked: {fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : '—'}</div>
            </div>
            <button
              onClick={() => {
                setLoading(true);
                load();
                onRefresh?.();
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-2 bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Fetch error — distinct from "no tournament has run". Never dressed up. */}
      {error && (
        <div className="bg-rose-950/40 border border-rose-700/70 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-rose-300">Research telemetry unavailable</div>
            <p className="text-rose-200/90 leading-relaxed">
              Could not read the tournament record for {activeSymbol}. This means the record was not retrieved — it does
              not mean no tournament has run.
            </p>
            <p className="text-[11px] text-rose-300/80">{error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton (initial only). */}
      {loading && !data && !error && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-900 border border-slate-800 rounded-xl" />
          ))}
        </div>
      )}

      {/* Honest empty state — available:false or tournament:null is a first-class state. */}
      {!loading && !error && !tournament && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-10 text-center">
          <SearchX className="w-10 h-10 text-slate-500 mx-auto mb-3" />
          <h3 className="text-base font-bold text-slate-200">No tournament has run yet</h3>
          <p className="text-xs text-slate-400 mt-2 max-w-xl mx-auto leading-relaxed">
            No tournament result is on record for <span className="text-slate-300">{activeSymbol}</span>. Nothing has
            been evaluated and nothing has been promoted. This is not an error — it simply means no evidence exists yet,
            so no metrics, gates or candidates are shown.
          </p>
        </div>
      )}

      {/* Tournament present */}
      {tournament && (() => {
        const t = tournament;
        const gates = t.gates;
        const champion = t.champion;
        const view = outcomeView(t);
        const tone = TONE[view.tone];
        const minTrades = typeof gates?.min_oos_trades === 'number' ? gates.min_oos_trades : null;

        return (
          <div className="space-y-6">
            {/* Outcome banner */}
            <div className={`border rounded-xl p-4 flex items-start gap-3 ${tone.box}`}>
              <span className="mt-0.5 shrink-0">{view.icon}</span>
              <div className="space-y-1">
                <div className={`text-sm font-extrabold tracking-wide ${tone.text}`}>{view.label}</div>
                <p className="text-slate-300 leading-relaxed">{view.blurb}</p>
              </div>
            </div>

            {/* L2 readiness — must be prominent: an assumption is not a measurement. */}
            <div
              className={`border rounded-xl p-4 flex items-start gap-3 ${
                t.l2_ready ? TONE.emerald.box : TONE.amber.box
              }`}
            >
              {t.l2_ready ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`text-sm font-bold ${t.l2_ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                    L2 ORDER-BOOK DATA: {t.l2_ready ? 'READY' : 'NOT READY'}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-950/60 text-slate-300 border border-slate-700">
                    peak spread {num(t.peak_spread_bps, 3)} bps
                  </span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {t.l2_ready
                    ? 'Depth data was available, so spread cost was MEASURED from the order book over the tournament window.'
                    : 'Depth data was missing. The spread cost used in these results is an ASSUMPTION, not a measurement — treat net-edge figures as optimistic until L2 data is collected.'}
                </p>
              </div>
            </div>

            {/* Run KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Candidates evaluated</span>
                  <Microscope className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">{int(t.candidates_evaluated)}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Candidates admitted</span>
                  <Trophy className="w-4 h-4 text-emerald-400" />
                </div>
                <div className={`mt-2 text-xl font-bold ${t.candidates_admitted > 0 ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {int(t.candidates_admitted)}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Generations</span>
                  <Layers className="w-4 h-4 text-indigo-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">{int(t.generations)}</div>
                <div className="text-[11px] text-slate-500">population {int(t.population_size)}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-400">Duration</span>
                  <Clock className="w-4 h-4 text-amber-400" />
                </div>
                <div className="mt-2 text-xl font-bold text-white">{formatDuration(t.duration_ms)}</div>
                <div className="text-[11px] text-slate-500">{int(t.duration_ms)} ms</div>
              </div>
            </div>

            {/* Champion + gates */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Champion */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Champion</h3>
                </div>

                {champion ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm text-white">{champion.model_id}</span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 text-[10px] font-bold">
                        {champion.family}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600 text-[10px] font-bold">
                        {champion.liquidity}
                      </span>
                      {champion.verified ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold inline-flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> VERIFIED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold inline-flex items-center gap-1">
                          <ShieldAlert className="w-3 h-3" /> NOT VERIFIED
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <Metric label="Net edge (bps)" value={num(champion.net_edge_bps, 3)} />
                      <Metric label="OOS Sharpe" value={num(champion.oos_sharpe, 3)} />
                      <Metric label="Profit factor" value={`${num(champion.profit_factor, 3)}x`} />
                      <Metric label="t-stat" value={num(champion.t_stat, 3)} />
                      <Metric label="OOS trades" value={int(champion.oos_trades)} />
                      <Metric label="Folds" value={int(champion.folds)} />
                    </div>

                    {typeof champion.max_drawdown_bps === 'number' && (
                      <div className="text-[11px] text-slate-400">
                        Max drawdown: <span className="text-slate-200">{num(champion.max_drawdown_bps, 3)} bps</span>
                      </div>
                    )}

                    {champion.rejection && (
                      <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800/70 text-amber-200 text-[11px] leading-relaxed">
                        <span className="font-bold">Rejection note: </span>
                        {champion.rejection}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-6 text-center bg-slate-950/50 rounded-lg border border-slate-800">
                    <SearchX className="w-7 h-7 text-slate-500 mx-auto mb-2" />
                    <p className="text-slate-300 font-medium">No champion in this run</p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      No candidate cleared every gate, so nothing was promoted. Metrics are not shown because none exist.
                    </p>
                  </div>
                )}
              </div>

              {/* Gates */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <Gauge className="w-4 h-4 text-cyan-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Gate verdicts</h3>
                </div>
                <p className="text-[11px] text-slate-500 mb-4">
                  Champion measured against every gate the backend reports.
                </p>
                <div className="space-y-2">
                  {GATE_DEFS.filter((g) => typeof gates?.[g.key] === 'number').map((g) => {
                    const threshold = gates[g.key];
                    const champVal =
                      champion && typeof (champion as any)[g.championField] === 'number'
                        ? (champion[g.championField] as unknown as number)
                        : null;
                    const pass = champVal === null ? null : champVal >= threshold;
                    return (
                      <div
                        key={g.key}
                        className="flex items-center justify-between gap-3 bg-slate-950/50 border border-slate-800/80 rounded-lg px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-slate-200 font-medium truncate">{g.label}</div>
                          <div className="text-[10px] text-slate-500 truncate">{g.hint}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[11px] text-slate-400">
                            need ≥ <span className="text-slate-200 font-bold">{num(threshold, 3)}{g.unit}</span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            champ <span className="text-slate-200 font-bold">{champVal === null ? '—' : `${num(champVal, 3)}${g.unit}`}</span>
                          </div>
                        </div>
                        <div className="shrink-0">
                          {pass === null ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-600">
                              NO CHAMPION
                            </span>
                          ) : pass ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> PASS
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                              <XCircle className="w-3 h-3" /> FAIL
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Promotion decision */}
            {t.promotion && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Promotion decision</h3>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                      t.promotion.allowed
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-slate-800 text-slate-300 border-slate-600'
                    }`}
                  >
                    {t.promotion.allowed ? 'PROMOTION ALLOWED' : 'PROMOTION NOT ALLOWED'}
                  </span>
                  <span className="text-slate-400">
                    Target state: <span className="text-slate-200 font-bold">{t.promotion.target_state}</span>
                  </span>
                  <span className="text-slate-300">{t.promotion.reason}</span>
                </div>
              </div>
            )}

            {/* Reproducibility */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Hash className="w-4 h-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Reproducibility</h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-[11px]">
                <Field label="Symbol" value={t.symbol} />
                <Field label="Tournament version" value={`v${int(t.version)}`} />
                <Field label="Seed" value={int(t.seed)} />
                <Field label="Bars used" value={int(t.bars_used)} />
                <Field label="Window" value={`${int(t.window_days)} days`} />
                <Field label="Duration" value={formatDuration(t.duration_ms)} />
                <Field label="Started" value={formatTs(t.started_at_ms)} />
                <Field label="Ended" value={formatTs(t.ended_at_ms)} />
              </div>
            </div>

            {/* Winners (admitted candidates) */}
            {t.winners && t.winners.length > 0 && (
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                    Admitted candidates ({t.winners.length})
                  </h3>
                </div>
                <div className="space-y-2">
                  {t.winners.map((w) => (
                    <div
                      key={w.model_id}
                      className="flex flex-wrap items-center justify-between gap-2 bg-slate-950/50 border border-slate-800/80 rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-200">{w.model_id}</span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
                          {w.family}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 text-[10px]">
                          {w.liquidity}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
                        <span>net <span className="text-slate-200 font-bold">{num(w.net_edge_bps, 3)} bps</span></span>
                        <span>sharpe <span className="text-slate-200 font-bold">{num(w.oos_sharpe, 3)}</span></span>
                        <span>trades <span className="text-slate-200 font-bold">{int(w.oos_trades)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rejected & ranked */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-slate-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                    Rejected candidates, ranked
                  </h3>
                </div>
                <span className="text-[11px] text-slate-500">
                  {t.rejected_ranked?.length ?? 0} shown
                </span>
              </div>
              <p className="text-[11px] text-slate-500 mb-4 flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                Candidates below {minTrades === null ? 'the minimum' : minTrades} OOS trades are
                labelled <span className="text-amber-300 font-bold">insufficient sample</span> — their net can look
                attractive purely by luck, and they are not close to promotion.
              </p>

              {t.rejected_ranked && t.rejected_ranked.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-800/50 text-slate-400 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="p-2.5">Family</th>
                        <th className="p-2.5">Liquidity</th>
                        <th className="p-2.5">OOS trades</th>
                        <th className="p-2.5">Net edge</th>
                        <th className="p-2.5">OOS Sharpe</th>
                        <th className="p-2.5">Profit factor</th>
                        <th className="p-2.5">t-stat</th>
                        <th className="p-2.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {t.rejected_ranked.map((r) => {
                        const insufficient = minTrades !== null && r.oos_trades < minTrades;
                        return (
                          <tr
                            key={r.model_id}
                            className={insufficient ? 'bg-amber-950/10 text-slate-500' : 'text-slate-200 hover:bg-slate-800/30'}
                          >
                            <td className="p-2.5">
                              <div className={`font-semibold ${insufficient ? 'text-slate-400' : 'text-white'}`}>
                                {r.family}
                              </div>
                              <div className="text-[10px] text-slate-600 font-mono truncate max-w-[160px]">{r.model_id}</div>
                            </td>
                            <td className="p-2.5">{r.liquidity}</td>
                            <td className="p-2.5">
                              <span className="font-bold">{int(r.oos_trades)}</span>
                              {insufficient && (
                                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 whitespace-nowrap">
                                  insufficient sample
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 font-mono">{num(r.net_edge_bps, 3)}</td>
                            <td className="p-2.5 font-mono">{num(r.oos_sharpe, 3)}</td>
                            <td className="p-2.5 font-mono">{num(r.profit_factor, 3)}x</td>
                            <td className="p-2.5 font-mono">{num(r.t_stat, 3)}</td>
                            <td className="p-2.5 text-slate-400 max-w-[280px]">{r.reason}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="py-6 text-center text-xs text-slate-500">
                  No rejected candidates were recorded for this run.
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Small presentational helpers                                        */
/* ------------------------------------------------------------------ */

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2.5">
    <span className="text-slate-500 block text-[10px] uppercase tracking-wider">{label}</span>
    <span className="text-slate-100 font-extrabold">{value}</span>
  </div>
);

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col">
    <span className="text-slate-500 text-[10px] uppercase tracking-wider">{label}</span>
    <span className="text-slate-200 font-medium truncate">{value}</span>
  </div>
);

export default MLResearchAuditLog;
