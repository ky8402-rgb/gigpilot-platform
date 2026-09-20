import React, { useState } from 'react';
import {
  Shield,
  ShieldAlert,
  Zap,
  Activity,
  ChevronDown,
  Lock,
  Radio,
  Cpu,
  RefreshCw,
  Sliders,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { AutonomyLevel, MarketRegime, TradingMode } from '../../types/trading';

interface HeaderNavProps {
  activeSymbol: string;
  onSelectSymbol: (sym: string) => void;
  pairs: Array<{
    symbol: string;
    price: number;
    change24hPct: number;
  }>;
  autonomyLevel: AutonomyLevel;
  onChangeAutonomyLevel: (lvl: AutonomyLevel) => void;
  tradingMode: TradingMode;
  onChangeTradingMode: (mode: TradingMode) => void;
  killSwitchActive: boolean;
  onTriggerKillSwitch: (reason: string) => void;
  onDeactivateKillSwitch: () => void;
  marketRegime: MarketRegime;
  latencyMs?: number;
}

export const HeaderNav: React.FC<HeaderNavProps> = ({
  activeSymbol,
  onSelectSymbol,
  pairs,
  autonomyLevel,
  onChangeAutonomyLevel,
  tradingMode,
  onChangeTradingMode,
  killSwitchActive,
  onTriggerKillSwitch,
  onDeactivateKillSwitch,
  marketRegime,
  latencyMs = 24
}) => {
  const [showKillModal, setShowKillModal] = useState(false);
  const [killReason, setKillReason] = useState('Manual emergency stop triggered by operator');
  const [showPairDropdown, setShowPairDropdown] = useState(false);
  const [showAutonomyDropdown, setShowAutonomyDropdown] = useState(false);

  const activePairInfo = pairs.find(p => p.symbol === activeSymbol) || {
    symbol: activeSymbol,
    price: 66850,
    change24hPct: 2.34
  };

  const autonomyLabels: Record<AutonomyLevel, { name: string; desc: string; color: string }> = {
    0: { name: 'LEVEL 0 · OBSERVE', desc: 'Read-only telemetry; no orders', color: 'text-slate-400 border-slate-700 bg-slate-900/60' },
    1: { name: 'LEVEL 1 · PAPER', desc: 'Autonomous paper execution (Default)', color: 'text-emerald-400 border-emerald-800/80 bg-emerald-950/40' },
    2: { name: 'LEVEL 2 · ASSISTED', desc: 'AI proposes; Owner manual approve', color: 'text-cyan-400 border-cyan-800/80 bg-cyan-950/40' },
    3: { name: 'LEVEL 3 · AUTONOMOUS', desc: 'Autonomous live strategy deployment', color: 'text-amber-400 border-amber-800/80 bg-amber-950/40' },
    4: { name: 'LEVEL 4 · CONTINUOUS', desc: 'Full AI research, test & live deploy loop', color: 'text-purple-400 border-purple-800/80 bg-purple-950/40' }
  };

  const getRegimeColor = (r: string) => {
    switch (r) {
      case 'BULL_TREND_STRONG': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'BEAR_TREND_STRONG': return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'RANGE_BOUND_HIGH_VOL': return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'RANGE_BOUND_LOW_VOL': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'BREAKOUT_VOLATILITY': return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  };

  return (
    <header className="border-b border-slate-800/80 bg-[#0B0F19]/95 backdrop-blur-md sticky top-0 z-40 px-4 py-2.5">
      <div className="max-w-[1700px] mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & Market Selector */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 pr-3 border-r border-slate-800">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-white font-bold text-base">
              <Zap className="w-4 h-4 text-emerald-100" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm tracking-wider text-white uppercase font-mono">AEGIS QUANT</span>
                <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">NEXUS</span>
              </div>
              <span className="text-[11px] text-slate-400">Autonomous Crypto Grid Engine</span>
            </div>
          </div>

          {/* Pair Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowPairDropdown(!showPairDropdown)}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-slate-900/90 hover:bg-slate-800/90 border border-slate-700/80 text-left transition-all"
            >
              <div>
                <div className="text-xs font-bold text-white font-mono flex items-center gap-1.5">
                  {activeSymbol}
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </div>
                <div className="text-[11px] flex items-center gap-2">
                  <span className="text-white font-mono font-semibold">${activePairInfo.price.toLocaleString()}</span>
                  <span className={activePairInfo.change24hPct >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                    {activePairInfo.change24hPct >= 0 ? '+' : ''}{activePairInfo.change24hPct}%
                  </span>
                </div>
              </div>
            </button>

            {showPairDropdown && (
              <div className="absolute left-0 mt-1 w-64 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 p-1 divide-y divide-slate-800">
                <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Supported Spot Grid Markets
                </div>
                <div className="py-1">
                  {pairs.map(p => (
                    <button
                      key={p.symbol}
                      onClick={() => {
                        onSelectSymbol(p.symbol);
                        setShowPairDropdown(false);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-2 text-xs rounded hover:bg-slate-800 transition-colors ${
                        p.symbol === activeSymbol ? 'bg-emerald-500/10 text-emerald-300 font-bold' : 'text-slate-200'
                      }`}
                    >
                      <span className="font-mono">{p.symbol}</span>
                      <div className="text-right font-mono">
                        <div>${p.price.toLocaleString()}</div>
                        <div className={`text-[10px] ${p.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {p.change24hPct >= 0 ? '+' : ''}{p.change24hPct}%
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Market Regime Badge */}
          <div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-xs ${getRegimeColor(marketRegime.regime)}`}>
            <Activity className="w-3.5 h-3.5 animate-pulse" />
            <span className="font-mono font-semibold text-[11px]">
              REGIME: {marketRegime.regime.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] opacity-80">({Math.round(marketRegime.confidence * 100)}% conf)</span>
          </div>
        </div>

        {/* Center: Autonomy Level & Mode Switcher */}
        <div className="flex items-center gap-2">
          {/* Autonomy Level */}
          <div className="relative">
            <button
              onClick={() => setShowAutonomyDropdown(!showAutonomyDropdown)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-md border text-xs font-semibold font-mono transition-all ${autonomyLabels[autonomyLevel].color}`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>{autonomyLabels[autonomyLevel].name}</span>
              <ChevronDown className="w-3 h-3 opacity-70" />
            </button>

            {showAutonomyDropdown && (
              <div className="absolute right-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl z-50 p-1.5 space-y-1">
                <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Select Autonomy Level
                </div>
                {([0, 1, 2, 3, 4] as AutonomyLevel[]).map(lvl => (
                  <button
                    key={lvl}
                    onClick={() => {
                      onChangeAutonomyLevel(lvl);
                      setShowAutonomyDropdown(false);
                    }}
                    className={`w-full text-left px-2.5 py-2 rounded text-xs transition-colors ${
                      autonomyLevel === lvl ? 'bg-slate-800 border border-slate-600' : 'hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="font-bold text-white font-mono">{autonomyLabels[lvl].name}</div>
                    <div className="text-[11px] text-slate-400">{autonomyLabels[lvl].desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Trading Mode Toggle (Simulation / Paper / Live) */}
          <div className="flex items-center bg-slate-900/90 rounded-md p-0.5 border border-slate-800">
            {(['SIMULATION', 'PAPER', 'LIVE'] as TradingMode[]).map(m => (
              <button
                key={m}
                onClick={() => onChangeTradingMode(m)}
                className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded transition-all ${
                  tradingMode === m
                    ? m === 'LIVE'
                      ? 'bg-rose-600 text-white shadow'
                      : 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Emergency KILL SWITCH & Operator Badge */}
        <div className="flex items-center gap-3">
          {/* Latency & Health */}
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] font-mono text-slate-400 bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{latencyMs}ms</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-300">AUTHORIZED OWNER</span>
          </div>

          {/* GLOBAL EMERGENCY KILL SWITCH */}
          {killSwitchActive ? (
            <button
              onClick={onDeactivateKillSwitch}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs font-mono rounded-md shadow-lg shadow-amber-500/20 animate-bounce transition-all uppercase"
            >
              <ShieldAlert className="w-4 h-4" />
              <span>KILL SWITCH ACTIVE (CLICK TO RESUME)</span>
            </button>
          ) : (
            <button
              onClick={() => setShowKillModal(true)}
              className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs font-mono rounded-md shadow-lg shadow-rose-600/30 transition-all border border-rose-400/40 uppercase tracking-wider"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>EMERGENCY KILL SWITCH</span>
            </button>
          )}
        </div>
      </div>

      {/* Kill Switch Confirmation Modal */}
      {showKillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-rose-600/60 rounded-xl max-w-md w-full p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <ShieldAlert className="w-8 h-8 text-rose-500" />
              <div>
                <h3 className="font-extrabold text-lg text-white font-mono">ENGAGE GLOBAL KILL SWITCH?</h3>
                <p className="text-xs text-rose-300">Instant circuit breaker & market order cancellation</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              Engaging the emergency Kill Switch will immediately:
            </p>
            <ul className="text-xs space-y-1.5 text-slate-300 mb-5 pl-2 list-disc list-inside">
              <li><strong className="text-rose-400">Cancel all open grid & limit orders</strong> across all pairs</li>
              <li>Halt the autonomous strategy engine & auto-rebalancing loop</li>
              <li>Block all incoming order execution attempts</li>
              <li>Disable automatic profit sweeping</li>
              <li>Record timestamped audit snapshot for post-mortem review</li>
            </ul>

            <div className="mb-5">
              <label className="text-xs font-semibold text-slate-400 block mb-1 font-mono">Audit Reason / Incident Tag:</label>
              <input
                type="text"
                value={killReason}
                onChange={e => setKillReason(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowKillModal(false)}
                className="px-4 py-2 rounded text-xs font-semibold text-slate-300 hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onTriggerKillSwitch(killReason);
                  setShowKillModal(false);
                }}
                className="px-5 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono uppercase tracking-wider shadow-lg shadow-rose-600/40 transition-all"
              >
                Confirm & Engage Kill Switch
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
