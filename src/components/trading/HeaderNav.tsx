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
  AlertTriangle,
  Power,
  KeyRound,
  ShieldCheck,
  Wallet,
  LogOut
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
  globalKillSwitchActive?: boolean;
  onTriggerKillSwitch: (reason: string) => void;
  onDeactivateKillSwitch: () => void;
  onToggleGlobalKillSwitch?: (active: boolean) => void;
  botsDisabled?: boolean;
  activeBotsCount?: number;
  marketRegime: MarketRegime;
  latencyMs?: number;
  isLiveConnected?: boolean;
  onReconnect?: () => void;
  isOwnerAuthenticated?: boolean;
  ownerEmail?: string;
  onOpenOwnerAuth?: () => void;
  onLogoutOwner?: () => void;
  onNavigateToAssets?: () => void;
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
  globalKillSwitchActive,
  onTriggerKillSwitch,
  onDeactivateKillSwitch,
  onToggleGlobalKillSwitch,
  botsDisabled,
  activeBotsCount,
  marketRegime,
  latencyMs = 24,
  isLiveConnected = false,
  onReconnect,
  isOwnerAuthenticated = false,
  ownerEmail = 'ky8402@gmail.com',
  onOpenOwnerAuth,
  onLogoutOwner,
  onNavigateToAssets
}) => {
  const isKillActive = globalKillSwitchActive !== undefined ? globalKillSwitchActive : killSwitchActive;
  const areBotsHalted = botsDisabled !== undefined ? botsDisabled : (isKillActive || autonomyLevel === 0);
  const [showKillModal, setShowKillModal] = useState(false);
  const [killReason, setKillReason] = useState('Emergency stop: Disabling all active trading bots');
  const [showPairDropdown, setShowPairDropdown] = useState(false);
  const [showAutonomyDropdown, setShowAutonomyDropdown] = useState(false);

  const formatTickerPrice = (pVal: number | undefined | null) => {
    if (pVal == null || isNaN(pVal)) return '—';
    if (pVal === 0) return '0.00';
    if (pVal < 0.001) return pVal.toFixed(6);
    if (pVal < 1) return pVal.toFixed(4);
    if (pVal < 10) return pVal.toFixed(3);
    if (pVal < 1000) return pVal.toFixed(2);
    return pVal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  };

  const normActive = activeSymbol.replace(/[\/\-_]/g, '').toUpperCase();
  const activePairInfo = pairs.find(p => p.symbol.replace(/[\/\-_]/g, '').toUpperCase() === normActive) || {
    symbol: activeSymbol,
    price: 85859.20,
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
                  <span className="text-white font-mono font-semibold">${formatTickerPrice(activePairInfo.price)}</span>
                  <span className={activePairInfo.change24hPct >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                    {activePairInfo.change24hPct >= 0 ? '+' : ''}{activePairInfo.change24hPct.toFixed(2)}%
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
                        p.symbol.replace(/[\/\-_]/g, '').toUpperCase() === normActive ? 'bg-emerald-500/10 text-emerald-300 font-bold' : 'text-slate-200'
                      }`}
                    >
                      <span className="font-mono">{p.symbol}</span>
                      <div className="text-right font-mono">
                        <div>${formatTickerPrice(p.price)}</div>
                        <div className={`text-[10px] ${p.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {p.change24hPct >= 0 ? '+' : ''}{p.change24hPct.toFixed(2)}%
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

        {/* Right: Prominent Global Kill Switch & Operator Badge */}
        <div className="flex items-center gap-3">
          {/* Latency & Health */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] font-mono bg-slate-900/80 px-2 py-1 rounded border border-slate-800">
            {isLiveConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="text-emerald-400 font-bold">LIVE ENGINE</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">{latencyMs}ms</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 font-bold">SIMULATION</span>
                {onReconnect && (
                  <button
                    onClick={onReconnect}
                    className="ml-1 text-[10px] text-amber-300 hover:text-white underline font-semibold cursor-pointer"
                  >
                    Connect Live
                  </button>
                )}
              </>
            )}
          </div>

          {/* Quick Assets Tab Button */}
          {onNavigateToAssets && (
            <button
              onClick={onNavigateToAssets}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold border border-slate-800 hover:border-amber-500/50 transition shadow-sm"
              title="View live Bybit spot assets & balances"
            >
              <Wallet className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Bybit Assets</span>
            </button>
          )}

          {/* Owner 2FA Status & Authentication Button */}
          {isOwnerAuthenticated ? (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-950/50 border border-emerald-800/80 text-emerald-300 text-xs font-mono">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <div className="hidden xl:flex flex-col text-[10px] leading-tight">
                <span className="font-bold text-emerald-200">OWNER VERIFIED</span>
                <span className="text-slate-400 truncate max-w-[120px]">{ownerEmail}</span>
              </div>
              {onLogoutOwner && (
                <button
                  onClick={onLogoutOwner}
                  className="p-1 hover:text-white transition"
                  title="Logout Owner Session"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={onOpenOwnerAuth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-semibold transition"
            >
              <KeyRound className="w-3.5 h-3.5 text-amber-400" />
              <span>Owner 2FA Login</span>
            </button>
          )}

          {/* PROMINENT GLOBAL KILL SWITCH TOGGLE BUTTON */}
          <div
            id="global-kill-switch-control"
            className={`flex items-center gap-3 px-3.5 py-1.5 rounded-lg border transition-all select-none shadow-md ${
              isKillActive
                ? 'bg-gradient-to-r from-rose-950 via-red-950 to-rose-900/90 border-rose-500 ring-2 ring-rose-500/50 shadow-rose-950/80 animate-pulse'
                : 'bg-slate-900/95 hover:bg-slate-850 border-rose-600/40 hover:border-rose-500/80'
            }`}
          >
            {/* Kill Switch Status Info */}
            <div
              className="flex flex-col text-left cursor-pointer"
              onClick={() => {
                if (isKillActive) {
                  if (onToggleGlobalKillSwitch) {
                    onToggleGlobalKillSwitch(false);
                  } else {
                    onDeactivateKillSwitch();
                  }
                } else {
                  setShowKillModal(true);
                }
              }}
              title={isKillActive ? 'Kill switch is active. Click to resume.' : 'Click to inspect or arm emergency shutdown'}
            >
              <div className="flex items-center gap-1.5">
                <ShieldAlert className={`w-4 h-4 ${isKillActive ? 'text-rose-400 animate-bounce' : 'text-rose-500'}`} />
                <span className="font-mono text-xs font-black uppercase tracking-wider text-white">
                  GLOBAL KILL SWITCH
                </span>
                {isKillActive && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-extrabold bg-rose-600 text-white animate-pulse uppercase tracking-wider">
                    ENGAGED
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isKillActive ? 'bg-rose-400 animate-ping' : 'bg-emerald-400'
                  }`}
                />
                <span
                  className={`text-[10px] font-mono font-bold tracking-tight ${
                    isKillActive ? 'text-rose-300 font-extrabold' : 'text-slate-400'
                  }`}
                >
                  {isKillActive
                    ? 'ALL ACTIVE TRADING BOTS DISABLED'
                    : areBotsHalted
                    ? 'GLOBAL_KILL_SWITCH_ACTIVE: FALSE · BOTS HALTED'
                    : `GLOBAL_KILL_SWITCH_ACTIVE: FALSE · BOTS ACTIVE (${activeBotsCount ?? 1})`}
                </span>
              </div>
            </div>

            {/* Prominent Mechanical Slider Toggle Button */}
            <button
              id="global-kill-switch-toggle-btn"
              type="button"
              role="switch"
              aria-checked={isKillActive}
              title={
                isKillActive
                  ? 'GLOBAL_KILL_SWITCH_ACTIVE is TRUE. Click to toggle OFF and restore bot execution.'
                  : 'Click to toggle Global Kill Switch ON (sets GLOBAL_KILL_SWITCH_ACTIVE to true and disables all active trading bots).'
              }
              onClick={(e) => {
                e.stopPropagation();
                if (isKillActive) {
                  if (onToggleGlobalKillSwitch) {
                    onToggleGlobalKillSwitch(false);
                  } else {
                    onDeactivateKillSwitch();
                  }
                } else {
                  if (onToggleGlobalKillSwitch) {
                    onToggleGlobalKillSwitch(true);
                  } else {
                    onTriggerKillSwitch('Global Kill Switch toggled ON via header: All active trading bots disabled');
                  }
                }
              }}
              className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 focus:ring-offset-slate-900 ${
                isKillActive
                  ? 'bg-rose-600 border-rose-400 shadow-inner'
                  : 'bg-slate-700/80 hover:bg-slate-600 border-slate-600'
              }`}
            >
              <span className="sr-only">Toggle Global Kill Switch</span>
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out flex items-center justify-center ${
                  isKillActive ? 'translate-x-6 bg-slate-100' : 'translate-x-0.5 bg-slate-200'
                }`}
              >
                {isKillActive ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                ) : (
                  <Power className="w-3.5 h-3.5 text-slate-700" />
                )}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Kill Switch Confirmation & Audit Modal */}
      {showKillModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-slate-900 border border-rose-600/60 rounded-xl max-w-md w-full p-6 shadow-2xl text-slate-100">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <ShieldAlert className="w-8 h-8 text-rose-500" />
              <div>
                <h3 className="font-extrabold text-lg text-white font-mono">ENGAGE GLOBAL KILL SWITCH?</h3>
                <p className="text-xs text-rose-300">Set GLOBAL_KILL_SWITCH_ACTIVE = true & halt all trading bots</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 mb-3 leading-relaxed">
              Toggling the Global Kill Switch to <strong className="text-rose-400">ACTIVE</strong> will immediately:
            </p>
            <ul className="text-xs space-y-1.5 text-slate-300 mb-5 pl-2 list-disc list-inside">
              <li><strong className="text-rose-400">Set GLOBAL_KILL_SWITCH_ACTIVE to true</strong></li>
              <li><strong className="text-rose-400">Disable all active trading bots</strong> (Autonomy reduced to Level 0 · Observe)</li>
              <li><strong className="text-rose-400">Cancel all open grid & limit orders</strong> across all pairs</li>
              <li>Block any incoming algorithmic execution orders</li>
              <li>Halt automated profit sweeping and rebalancing loops</li>
              <li>Record timestamped cryptographic audit trail</li>
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
                  if (onToggleGlobalKillSwitch) {
                    onToggleGlobalKillSwitch(true);
                  } else {
                    onTriggerKillSwitch(killReason);
                  }
                  setShowKillModal(false);
                }}
                className="px-5 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono uppercase tracking-wider shadow-lg shadow-rose-600/40 transition-all flex items-center gap-1.5"
              >
                <Power className="w-3.5 h-3.5" />
                <span>Toggle ON & Disable Bots</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
