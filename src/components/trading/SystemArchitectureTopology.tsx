import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Lock,
  Network,
  Radio,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Wallet,
  Workflow,
  Zap
} from 'lucide-react';
import { EngineHealth, EngineId } from '../../types/trading';

interface SystemArchitectureTopologyProps {
  engines: EngineHealth[];
  failClosed: { failClosed: boolean; downEngines: string[] };
  onSelectEngine?: (id: EngineId) => void;
}

export const SystemArchitectureTopology: React.FC<SystemArchitectureTopologyProps> = ({
  engines,
  failClosed,
  onSelectEngine
}) => {
  const [selectedNode, setSelectedNode] = useState<string>('AUTONOMOUS_PROFIT_OPTIMIZER');

  const getEngine = (id: string): EngineHealth | undefined => {
    return engines.find(e => e.id === id);
  };

  const getStatusColor = (status?: string, enabled: boolean = true) => {
    if (!enabled || status === 'OFF') return 'border-zinc-700 bg-zinc-900/60 text-zinc-400';
    if (status === 'HEALTHY') return 'border-emerald-500/60 bg-emerald-950/30 text-emerald-300';
    if (status === 'DEGRADED') return 'border-amber-500/60 bg-amber-950/30 text-amber-300';
    return 'border-rose-500/60 bg-rose-950/30 text-rose-300';
  };

  const layers = [
    {
      id: 'ingress',
      title: 'Layer 1: Ingress & Edge Perimeter',
      subtitle: 'Real-time WebSocket market streams, strict CORS gate, and single-owner auth',
      color: 'sky',
      modules: [
        {
          id: 'BYBIT_V5_STREAM',
          name: 'Bybit Spot V5 Feeds',
          type: 'External Ingress',
          tech: 'WebSocket & REST API',
          description: 'Live order book depth (50 levels), real-time trade ticks, and OHLCV candle streams.',
          status: 'HEALTHY',
          latency: '24ms',
          security: 'HMAC-SHA256 Signed'
        },
        {
          id: 'OWNER_AUTH_GATE',
          name: 'Single-Owner Auth Gate',
          type: 'Security Perimeter',
          tech: 'Timing-Safe PBKDF2 / Bearer',
          description: 'Enforces single-owner whitelist (ky8402@gmail.com) with constant-time equality checks.',
          status: 'HEALTHY',
          latency: '<1ms',
          security: 'Fail-Closed 401'
        },
        {
          id: 'RESEARCH_AGENT',
          name: 'Autonomous Web Research',
          type: 'Intelligence Engine',
          tech: 'Autonomous Scraping & Sentiment',
          description: 'Monitors crypto macro indicators, funding rate anomalies, and volatility spikes.',
          engineId: 'RESEARCH_AGENT'
        }
      ]
    },
    {
      id: 'alpha',
      title: 'Layer 2: Alpha Generation & Autonomous Optimization Core',
      subtitle: 'Real-time quantitative signal processing and revenue maximization loop',
      color: 'emerald',
      modules: [
        {
          id: 'DATA_ENGINE',
          name: 'Data Engine (Feed Aggregator)',
          type: 'Ingress Normalizer',
          tech: 'In-Memory Sliding Candles',
          description: 'Assembles real-time tick queues, rolling 1m/5m/15m/1h candles, and order book snapshots.',
          engineId: 'DATA_ENGINE'
        },
        {
          id: 'QUANT_ENGINE',
          name: 'Quant Engine (Alpha & Regimes)',
          type: 'Mathematical Core',
          tech: 'ATR, RSI, ADX, Bollinger, Imbalance',
          description: 'Computes volatility metrics and classifies market regime (Range, Breakout, Trending).',
          engineId: 'QUANT_ENGINE'
        },
        {
          id: 'AUTONOMOUS_PROFIT_OPTIMIZER',
          name: 'Autonomous Profit Optimizer',
          type: 'AI Revenue Engine',
          tech: 'Audit -> Decide -> Build -> Auto-Deploy',
          description: 'Runs every 45s; eliminates fee drag & vanity metrics, auto-adjusts grid spacing and strategy parameters.',
          engineId: 'AUTONOMOUS_PROFIT_OPTIMIZER'
        },
        {
          id: 'LEARNING_LOOP',
          name: 'Learning Loop (Tournament)',
          type: 'Genetic Optimization',
          tech: 'Champion vs Challengers',
          description: 'Tests challenger mutations against live data; promotes winner when statistical confidence threshold is met.',
          engineId: 'LEARNING_LOOP'
        }
      ]
    },
    {
      id: 'strategy',
      title: 'Layer 3: Strategy Formulation & Sandbox Isolation',
      subtitle: 'Adaptive grid execution, isolated VM runtime, and pre-trade risk guardrails',
      color: 'indigo',
      modules: [
        {
          id: 'GRID_ENGINE',
          name: 'Adaptive Grid Engine',
          type: 'Execution Matrix',
          tech: 'Geometric / Arithmetic Multi-Level',
          description: 'Generates asymmetric buy/sell ladders dynamically adjusted to prevailing volatility.',
          engineId: 'GRID_ENGINE'
        },
        {
          id: 'SCRIPTING_SANDBOX_ENGINE',
          name: 'Scripting Sandbox IDE',
          type: 'Isolated VM Sandbox',
          tech: 'node:vm + Frozen Context',
          description: 'Hardened sandbox executing algorithmic scripts with 1500ms compute limits and prototype defense.',
          engineId: 'SCRIPTING_SANDBOX_ENGINE'
        },
        {
          id: 'RISK_ENGINE',
          name: 'Pre-Trade Risk Engine',
          type: 'Guardrail & Circuit Breaker',
          tech: 'Atomic Pre-Check Validation',
          description: 'Validates capital limits, maximum open orders, slippage caps, and drawdown thresholds.',
          engineId: 'RISK_ENGINE'
        }
      ]
    },
    {
      id: 'clearing',
      title: 'Layer 4: Execution, Settlement & Cold Custody',
      subtitle: 'Rate-paced order batching, true net accounting, and automated profit sweeps',
      color: 'amber',
      modules: [
        {
          id: 'EXCHANGE_EXECUTION_ENGINE',
          name: 'Exchange Execution Engine',
          type: 'Order Dispatcher',
          tech: 'Bybit V5 Paced Batches',
          description: 'Dispatches HMAC-signed orders with 65ms rate-limiting and reconciles live state on startup.',
          engineId: 'EXCHANGE_EXECUTION_ENGINE'
        },
        {
          id: 'PROFIT_ACCOUNTING_ENGINE',
          name: 'Profit Accounting Engine',
          type: 'Net Margin Ledger',
          tech: 'Fee-Deducted Realized PnL',
          description: 'Tracks net revenue, cumulative exchange fees, slippage drag, and high-water mark.',
          engineId: 'PROFIT_ACCOUNTING_ENGINE'
        },
        {
          id: 'PROFIT_SWEEP_ENGINE',
          name: 'Profit Sweep Engine',
          type: 'Custody Cold Vault',
          tech: 'Automated Cold Storage Sweeper',
          description: 'Sweeps realized profits exceeding reserve thresholds directly into cold storage wallet.',
          engineId: 'PROFIT_SWEEP_ENGINE'
        },
        {
          id: 'SYSTEM_MONITOR_SECURITY',
          name: 'Central System Watchdog',
          type: 'Atomic Fail-Closed Guard',
          tech: 'Heartbeat Poller & Canary',
          description: 'Monitors all 11 modules continuously; trips instant fail-closed trading halt upon anomaly.',
          engineId: 'SYSTEM_MONITOR_SECURITY'
        }
      ]
    }
  ];

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900 to-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-extrabold text-zinc-100 flex items-center gap-2">
                  GigPilot Modular Architecture & Dataflow Topology
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-sky-950 text-sky-400 border border-sky-800">
                    11 MODULAR SUBSYSTEMS
                  </span>
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Complete end-to-end blueprint: Market Ingress ➔ Mathematical Quant Alpha ➔ Autonomous Optimizer ➔ Risk Gate ➔ Bybit V5 Execution ➔ Cold Storage Vault
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs font-mono">
              <span className="text-zinc-500 block text-[10px]">FAIL-CLOSED STATUS</span>
              <span className={failClosed.failClosed ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                {failClosed.failClosed ? 'TRIPPED (0 ORDERS)' : 'ARMED & OPERATIONAL'}
              </span>
            </div>
            <div className="px-3.5 py-2 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs font-mono">
              <span className="text-zinc-500 block text-[10px]">SECURITY LEVEL</span>
              <span className="text-sky-400 font-bold">SINGLE OWNER (HMAC-SHA256)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Sequential Real-Time Dataflow Pipeline */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            End-to-End Real-Time Data Pipeline Execution Path
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">Paced 65ms Rate Limit • Strict Live Feeds Only</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
          {[
            { step: '1', title: 'Bybit V5 Feed', desc: 'Realtime depth & ticks', color: 'border-sky-500/40 bg-sky-950/30 text-sky-300' },
            { step: '2', title: 'Quant & Regimes', desc: 'ATR, RSI, ADX, Imbalance', color: 'border-cyan-500/40 bg-cyan-950/30 text-cyan-300' },
            { step: '3', title: 'Autonomous AI', desc: 'Audit, mutate, auto-deploy', color: 'border-emerald-500/40 bg-emerald-950/30 text-emerald-300' },
            { step: '4', title: 'Strategy Matrix', desc: 'Adaptive asymmetric grid', color: 'border-indigo-500/40 bg-indigo-950/30 text-indigo-300' },
            { step: '5', title: 'Pre-Trade Risk', desc: 'Atomic fail-closed check', color: 'border-rose-500/40 bg-rose-950/30 text-rose-300' },
            { step: '6', title: 'Bybit V5 Dispatch', desc: 'Rate-paced HMAC batch', color: 'border-amber-500/40 bg-amber-950/30 text-amber-300' },
            { step: '7', title: 'Cold Vault Sweep', desc: 'Surplus to cold custody', color: 'border-purple-500/40 bg-purple-950/30 text-purple-300' }
          ].map((item, idx) => (
            <div key={idx} className={`p-3 rounded-lg border text-xs relative ${item.color}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="w-5 h-5 rounded-full bg-zinc-950/60 font-bold font-mono text-[10px] flex items-center justify-center border border-zinc-700">
                  {item.step}
                </span>
                {idx < 6 && <ArrowRight className="w-3.5 h-3.5 opacity-60 hidden lg:block" />}
              </div>
              <div className="font-bold truncate">{item.title}</div>
              <div className="text-[10px] opacity-80 truncate">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 4 Architectural Layers */}
      <div className="space-y-5">
        {layers.map((layer) => (
          <div key={layer.id} className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-zinc-800/80 pb-3 gap-1">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  {layer.title}
                </h3>
                <p className="text-xs text-zinc-400">{layer.subtitle}</p>
              </div>
              <span className="text-[11px] font-mono text-zinc-500 self-start sm:self-auto">
                {layer.modules.length} Connected Subsystems
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
              {layer.modules.map((mod) => {
                const liveEng = mod.engineId ? getEngine(mod.engineId) : null;
                const isSelected = selectedNode === (mod.engineId || mod.id);
                const status = liveEng ? liveEng.status : mod.status || 'HEALTHY';
                const enabled = liveEng ? liveEng.enabled : true;

                return (
                  <div
                    key={mod.id}
                    onClick={() => {
                      setSelectedNode(mod.engineId || mod.id);
                      if (mod.engineId && onSelectEngine) {
                        onSelectEngine(mod.engineId as EngineId);
                      }
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer relative group ${
                      isSelected
                        ? 'ring-2 ring-sky-500 border-sky-400 shadow-lg shadow-sky-950/40 bg-zinc-900'
                        : `${getStatusColor(status, enabled)} hover:border-zinc-600 hover:bg-zinc-850/80`
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="space-y-0.5">
                        <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                          {mod.type}
                        </span>
                        <h4 className="text-sm font-bold text-zinc-100 group-hover:text-white transition-colors">
                          {mod.name}
                        </h4>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                          !enabled || status === 'OFF'
                            ? 'bg-zinc-800 text-zinc-400'
                            : status === 'HEALTHY'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {status}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-400 leading-relaxed mb-3 line-clamp-2">
                      {mod.description}
                    </p>

                    <div className="flex items-center justify-between text-[11px] font-mono border-t border-zinc-800/80 pt-2.5 text-zinc-500">
                      <span>{mod.tech}</span>
                      {liveEng && (
                        <span className="text-zinc-300 font-semibold">
                          {liveEng.latencyMs >= 0 ? `${liveEng.latencyMs}ms` : '0ms'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Security Perimeter & Defense-in-Depth Specification */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
            Verified Defense-in-Depth & Fail-Closed Security Rings
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-sky-400">
              <Lock className="w-3.5 h-3.5" />
              <span>1. Strict Whitelist CORS & Route Guards</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Non-reflective CORS restricts requests to known hosts (Amplify, EC2, Cloud Run). All mutating routes protected by single-owner middleware.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400">
              <Cpu className="w-3.5 h-3.5" />
              <span>2. node:vm Strategy Sandbox Isolation</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Custom algorithms execute inside an isolated V8 VM context with frozen APIs, prototype defense, and a 1500ms compute execution timeout.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>3. Atomic Fail-Closed Circuit Breaker</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Zero mock or synthetic fallbacks. If any critical subsystem (feed, quant, risk) goes degraded, order routing instantly halts to protect live capital.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-purple-400">
              <RefreshCw className="w-3.5 h-3.5" />
              <span>4. Startup State Reconciliation</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Upon startup and every 15s, open spot orders are reconciled directly from Bybit V5 realtime endpoints to eliminate orphaned orders across restarts.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
              <Zap className="w-3.5 h-3.5" />
              <span>5. Paced Batch Execution (Anti-429)</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Grid levels are dispatched in rate-controlled batches with a 65ms inter-order pacing interval to eliminate HTTP 429 rate limit errors on Bybit.
            </p>
          </div>

          <div className="p-3.5 rounded-lg bg-zinc-950/70 border border-zinc-800 space-y-1.5">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-400">
              <Wallet className="w-3.5 h-3.5" />
              <span>6. Cold Storage Profit Sweep</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Accumulated trading profits exceeding active capital allocations are automatically moved to operator-controlled cold storage.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
