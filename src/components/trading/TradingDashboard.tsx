import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  MasterTradingState,
  AutonomyLevel,
  TradingMode,
  StrategyVersion
} from '../../types/trading';
import {
  fetchTradingState,
  fetchAllPairs,
  fetchPairDetails,
  selectActivePair,
  setAutonomyLevel,
  setTradingMode,
  triggerKillSwitch,
  deactivateKillSwitch,
  toggleGlobalKillSwitch,
  configureGrid,
  placeManualOrder,
  cancelOrder,
  cancelAllOrders,
  fetchStrategies,
  promoteChallenger,
  createStrategyVariant,
  fetchWebResearch,
  fetchProfitSweepInfo,
  fetchRiskData,
  fetchUpdatesHistory,
  fetchAuditLogs,
  isEngineLiveConnected,
  fetchOwnerAuthStatus,
  logoutOwner,
  getStoredOwnerToken,
  triggerAutonomousOptimizerRun,
  toggleAutonomousOptimizer,
  reallocateStrategyCapital,
  rollbackStrategy
} from '../../services/tradingService';
import {
  generateDefaultMasterState,
  generateDefaultGrid,
  generateDefaultOrders,
  generateDefaultPosition,
  DEFAULT_PAIRS,
  DEFAULT_CHAMPION_STRATEGY,
  DEFAULT_RESEARCH_ITEMS,
  DEFAULT_DESTINATION_WALLET,
  DEFAULT_SWEEPS,
  DEFAULT_RISK_DATA,
  DEFAULT_SYSTEM_UPDATES,
  DEFAULT_AUDIT_LOGS
} from '../../data/defaultTradingData';

import { HeaderNav } from './HeaderNav';
import { CapitalMetricsBar } from './CapitalMetricsBar';
import { InteractiveGridChart } from './InteractiveGridChart';
import { GridMatrixAndOrders } from './GridMatrixAndOrders';
import { AdaptiveGridConfigurator } from './AdaptiveGridConfigurator';
import { LearningLoopView } from './LearningLoopView';
import { ScriptingIdeView } from './ScriptingIdeView';
import { ProfitSweepView } from './ProfitSweepView';
import { WebResearchView } from './WebResearchView';
import { RiskAndSafetyView } from './RiskAndSafetyView';
import { CredentialVaultView } from './CredentialVaultView';
import { CanaryAndAuditView } from './CanaryAndAuditView';
import { AssetDashboard } from './AssetDashboard';
import { OwnerAuthModal } from './OwnerAuthModal';
import { AutonomousRevenueEngineView } from './AutonomousRevenueEngineView';
import { GigPilotFuturesView } from './GigPilotFuturesView';
import { ReconciliationTerminal } from './ReconciliationTerminal';
import { FuturesCommandCenter } from './FuturesCommandCenter';
import { MLResearchAuditLog } from './MLResearchAuditLog';

import {
  BarChart2,
  Sliders,
  Trophy,
  Code,
  Wallet,
  Globe,
  ShieldAlert,
  GitPullRequest,
  RefreshCw,
  Cpu,
  Wifi,
  WifiOff,
  Coins,
  Server,
  Sparkles,
  FlaskConical
} from 'lucide-react';
import { EngineHealthView } from './EngineHealthView';
import { TradingReadinessBanner } from './TradingReadinessBanner';
import { RegimeTransitionView } from './RegimeTransitionView';
import { InventoryAwareGridView } from './InventoryAwareGridView';
import { DecisionPipelineVisualizer } from './DecisionPipelineVisualizer';
import { Activity, KeyRound, Scale, Shield, Zap } from 'lucide-react';

export type ActiveTerminalTab =
  | 'TERMINAL'
  | 'FUTURES_COMMAND'
  | 'GIGPILOT_FUTURES'
  | 'RECONCILIATION'
  | 'DECISION_PIPELINE'
  | 'AUTONOMOUS_OPTIMIZER'
  | 'REGIME_TRANSITION'
  | 'INVENTORY_AWARE_GRID'
  | 'ENGINES'
  | 'ASSETS'
  | 'ADAPTIVE_GRID'
  | 'LEARNING_LOOP'
  | 'ML_RESEARCH'
  | 'SCRIPTING_IDE'
  | 'PROFIT_SWEEP'
  | 'WEB_RESEARCH'
  | 'RISK_SAFETY'
  | 'SYSTEM_CANARY'
  | 'CREDENTIAL_VAULT';

export interface TradingDashboardProps {
  onLogout?: () => void;
}

export const TradingDashboard: React.FC<TradingDashboardProps> = ({ onLogout }) => {
  const [activeTab, setActiveTab] = useState<ActiveTerminalTab>('FUTURES_COMMAND');
  // Initialize with complete, realistic master state immediately so the app never blocks on loading
  const [state, setState] = useState<MasterTradingState>(() => generateDefaultMasterState());
  const [pairs, setPairs] = useState<Array<{ symbol: string; price: number; change24hPct: number }>>(() => DEFAULT_PAIRS);
  const [pairDetails, setPairDetails] = useState<any>(null);
  const [strategies, setStrategies] = useState<{
    champion: StrategyVersion;
    challengers: StrategyVersion[];
    history: StrategyVersion[];
    rollbackTelemetry?: any;
  }>(() => ({
    champion: DEFAULT_CHAMPION_STRATEGY,
    challengers: [],
    history: []
  }));
  const [researchItems, setResearchItems] = useState<any[]>(() => DEFAULT_RESEARCH_ITEMS);
  const [profitSweepInfo, setProfitSweepInfo] = useState<any>(() => ({
    destinationWallet: DEFAULT_DESTINATION_WALLET,
    minSweepThresholdUsd: 500,
    profitReserveBufferUsd: 300,
    eligibility: {
      eligibleAmount: 1880.50,
      canSweep: true,
      reserveRetained: 300.00
    },
    history: DEFAULT_SWEEPS
  }));
  const [riskData, setRiskData] = useState<any>(() => ({
    config: DEFAULT_RISK_DATA as any,
    circuitBreakerActive: false,
    events: []
  }));
  const [updatesHistory, setUpdatesHistory] = useState<any[]>(() => DEFAULT_SYSTEM_UPDATES);
  const [auditLogs, setAuditLogs] = useState<any[]>(() => DEFAULT_AUDIT_LOGS);
  const [globalKillSwitchActive, setGlobalKillSwitchActive] = useState<boolean>(true);
  const [isLiveConnected, setIsLiveConnected] = useState<boolean>(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOwnerAuth, setIsOwnerAuth] = useState<boolean>(() => !!getStoredOwnerToken());
  const [ownerEmail, setOwnerEmail] = useState<string>('ky8402@gmail.com');
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Load state from backend with graceful degradation and auto-failover
  const loadFullState = useCallback(async () => {
    try {
      // 1. Fetch Core System State first
      const masterState = await fetchTradingState();
      setState(masterState);
      setGlobalKillSwitchActive(Boolean(masterState.GLOBAL_KILL_SWITCH_ACTIVE ?? masterState.killSwitch?.isActive));
      setIsLiveConnected(isEngineLiveConnected());

      // 2. Fetch auxiliary telemetry in parallel with allSettled so individual failures don't block
      const [
        pairsRes,
        stratRes,
        researchRes,
        sweepRes,
        riskRes,
        updatesRes,
        logsRes,
        pairDetailsRes
      ] = await Promise.allSettled([
        fetchAllPairs(),
        fetchStrategies(),
        fetchWebResearch(),
        fetchProfitSweepInfo(),
        fetchRiskData(),
        fetchUpdatesHistory(),
        fetchAuditLogs(),
        masterState.activeSymbol ? fetchPairDetails(masterState.activeSymbol) : Promise.resolve(null)
      ]);

      if (pairsRes.status === 'fulfilled') setPairs(pairsRes.value);
      if (stratRes.status === 'fulfilled') setStrategies(stratRes.value);
      if (researchRes.status === 'fulfilled') setResearchItems(researchRes.value.items);
      if (sweepRes.status === 'fulfilled') setProfitSweepInfo(sweepRes.value);
      if (riskRes.status === 'fulfilled') setRiskData(riskRes.value);
      if (updatesRes.status === 'fulfilled') setUpdatesHistory(updatesRes.value.updates);
      if (logsRes.status === 'fulfilled') setAuditLogs(logsRes.value.logs);
      if (pairDetailsRes.status === 'fulfilled' && pairDetailsRes.value) setPairDetails(pairDetailsRes.value);
    } catch (err: any) {
      console.warn('[TradingDashboard] Telemetry notice:', err.message || err);
      setIsLiveConnected(false);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadFullState();

    // 3s polling loop for live telemetry
    const interval = setInterval(() => {
      loadFullState();
    }, 3000);

    return () => clearInterval(interval);
  }, [loadFullState]);

  // Check and sync Owner 2FA authentication state
  useEffect(() => {
    fetchOwnerAuthStatus().then((status) => {
      setIsOwnerAuth(status.isAuthenticated);
      if (status.ownerEmail) setOwnerEmail(status.ownerEmail);
    }).catch(() => {});
  }, []);

  const handleLogoutOwner = async () => {
    await logoutOwner();
    setIsOwnerAuth(false);
    if (onLogout) {
      onLogout();
    }
  };

  const handleToggleGlobalKillSwitch = async (activate?: boolean) => {
    const nextActive = activate !== undefined ? activate : !globalKillSwitchActive;
    setGlobalKillSwitchActive(nextActive);

    // Optimistically update local state so bots immediately show as disabled
    setState(prev => ({
      ...prev,
      GLOBAL_KILL_SWITCH_ACTIVE: nextActive,
      botsDisabled: nextActive,
      autonomyLevel: nextActive ? 0 : (prev.autonomyLevel || 1),
      activeBotsCount: nextActive ? 0 : 1,
      killSwitch: {
        ...prev.killSwitch,
        isActive: nextActive,
        triggeredAt: nextActive ? new Date().toISOString() : undefined,
        triggeredBy: nextActive ? 'Header Global Kill Switch Toggle' : 'None'
      }
    }));

    try {
      if (nextActive) {
        await triggerKillSwitch('Global Kill Switch engaged via header toggle: Disabling all active trading bots');
      } else {
        await deactivateKillSwitch();
      }
      await loadFullState();
    } catch (err: any) {
      console.error('Failed to toggle Global Kill Switch:', err);
    }
  };

  const handleTriggerAuditAndBuild = async () => {
    try {
      await triggerAutonomousOptimizerRun();
      await loadFullState();
    } catch (err: any) {
      console.error('Failed to trigger autonomous optimization cycle:', err);
    }
  };

  const handleReallocateCapital = async () => {
    try {
      await reallocateStrategyCapital();
      await loadFullState();
    } catch (err: any) {
      console.error('Failed to reallocate strategy capital:', err);
    }
  };

  const handleToggleAutoApply = async (enabled: boolean) => {
    try {
      await toggleAutonomousOptimizer(enabled);
      await loadFullState();
    } catch (err: any) {
      console.error('Failed to toggle auto-apply mode:', err);
    }
  };

  const activePairInfo = pairs.find(p => p.symbol.replace(/[\/\-_]/g, '').toUpperCase() === state.activeSymbol.replace(/[\/\-_]/g, '').toUpperCase());
  const activePrice = (pairDetails?.currentPrice && pairDetails.currentPrice > 0)
    ? pairDetails.currentPrice
    : (activePairInfo?.price || DEFAULT_PAIRS.find(p => p.symbol.replace(/[\/\-_]/g, '').toUpperCase() === state.activeSymbol.replace(/[\/\-_]/g, '').toUpperCase())?.price || 85859.20);

  if (activeTab === 'FUTURES_COMMAND') {
    return <FuturesCommandCenter />;
  }

  return (
    <div className="min-h-screen bg-[#070B14] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-black">
      {/* 1. Header Navigation & Emergency Kill Switch */}
      <HeaderNav
        activeSymbol={state.activeSymbol}
        onSelectSymbol={async (sym) => {
          setState(prev => ({
            ...prev,
            activeSymbol: sym,
            activeGrid: generateDefaultGrid(sym),
            openOrders: generateDefaultOrders(sym),
            position: generateDefaultPosition(sym)
          }));
          await selectActivePair(sym);
          const pd = await fetchPairDetails(sym);
          if (pd) setPairDetails(pd);
          loadFullState();
        }}
        pairs={pairs}
        autonomyLevel={state.autonomyLevel}
        onChangeAutonomyLevel={async (lvl) => {
          await setAutonomyLevel(lvl);
          loadFullState();
        }}
        tradingMode={state.tradingMode}
        onChangeTradingMode={async (mode) => {
          await setTradingMode(mode);
          loadFullState();
        }}
        killSwitchActive={state.killSwitch.isActive}
        globalKillSwitchActive={globalKillSwitchActive || state.killSwitch.isActive || !!state.GLOBAL_KILL_SWITCH_ACTIVE}
        onTriggerKillSwitch={async (reason) => {
          await triggerKillSwitch(reason);
          setGlobalKillSwitchActive(true);
          loadFullState();
        }}
        onDeactivateKillSwitch={async () => {
          await deactivateKillSwitch();
          setGlobalKillSwitchActive(false);
          loadFullState();
        }}
        onToggleGlobalKillSwitch={handleToggleGlobalKillSwitch}
        botsDisabled={globalKillSwitchActive || state.killSwitch.isActive || !!state.botsDisabled || state.autonomyLevel === 0}
        activeBotsCount={(globalKillSwitchActive || state.killSwitch.isActive || state.autonomyLevel === 0) ? 0 : 1}
        marketRegime={state.currentRegime}
        isLiveConnected={isLiveConnected}
        onReconnect={() => {
          setRefreshing(true);
          loadFullState();
        }}
        isOwnerAuthenticated={isOwnerAuth}
        ownerEmail={ownerEmail}
        onOpenOwnerAuth={() => setShowAuthModal(true)}
        onLogoutOwner={handleLogoutOwner}
        onNavigateToAssets={() => setActiveTab('ASSETS')}
        onOpenRegimeTransition={() => setActiveTab('REGIME_TRANSITION')}
        inventoryAwareness={state.activeGrid?.inventoryAwareness}
        onOpenInventoryGrid={() => setActiveTab('INVENTORY_AWARE_GRID')}
        onNavigateToDecisions={() => setActiveTab('DECISION_PIPELINE')}
        decisionStats={state.decisionStats}
      />

      {/* Backend Synchronization Notification Bar */}
      {!isLiveConnected && (
        <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border-b border-amber-500/30 px-4 py-1.5 text-amber-200 font-mono text-[11px] flex flex-wrap items-center justify-between gap-2 z-20">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-bold text-amber-300">BACKEND EXCHANGE GATEWAY CONNECTING:</span>
            <span className="text-slate-300">
              Live spot market prices, balances, and orders stream directly from Bybit Spot V5 API.
            </span>
          </div>
          <button
            onClick={() => {
              setRefreshing(true);
              loadFullState();
            }}
            disabled={refreshing}
            className="px-2.5 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-bold uppercase tracking-wider rounded transition-all flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Connecting...' : 'Sync Live Gateway'}</span>
          </button>
        </div>
      )}

      {/* Fail-Closed System Health Alert Banner */}
      {state.failClosedStatus?.failClosed && (
        <div className="bg-gradient-to-r from-red-950 via-rose-950 to-red-950 border-b-2 border-red-500 px-4 py-2 text-rose-100 font-mono text-xs shadow-2xl flex flex-wrap items-center justify-between gap-3 z-30">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
            <div>
              <span className="font-black text-red-300 uppercase tracking-widest mr-2">
                [FAIL-CLOSED ACTIVE]
              </span>
              <span className="text-red-100 font-semibold">
                Critical engine degradation detected: {state.failClosedStatus.downEngines.join(', ')}. All autonomous live execution suspended. Zero synthetic fallback permitted.
              </span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('ENGINES')}
            className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider rounded transition-colors"
          >
            Inspect Engines
          </button>
        </div>
      )}

      {/* Emergency Global Kill Switch Banner */}
      {(globalKillSwitchActive || state.killSwitch.isActive || state.GLOBAL_KILL_SWITCH_ACTIVE) && (
        <div className="bg-gradient-to-r from-rose-950 via-red-950 to-rose-900 border-b border-rose-500/80 px-4 py-2.5 text-rose-100 font-mono text-xs shadow-xl flex flex-wrap items-center justify-between gap-3 z-30">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" />
            <div>
              <span className="font-black text-white uppercase tracking-wider mr-2">
                GLOBAL_KILL_SWITCH_ACTIVE: TRUE
              </span>
              <span className="text-rose-200">
                All active trading bots are disabled & halted. Open market grid limit orders have been cancelled.
              </span>
            </div>
          </div>
          <button
            onClick={() => handleToggleGlobalKillSwitch(false)}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider rounded-md shadow transition-all flex items-center gap-1.5"
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Resume & Enable Bots</span>
          </button>
        </div>
      )}

      {/* Dynamic Regime Transition Safeguards Alert Banner */}
      {state.currentRegime.transition?.isTransitioning && (
        <div className="bg-gradient-to-r from-amber-950 via-slate-900 to-amber-950 border-b border-amber-500/60 px-4 py-2 text-amber-100 font-mono text-xs shadow-lg flex flex-wrap items-center justify-between gap-3 z-30">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
            <div>
              <span className="font-bold text-amber-300 uppercase mr-2">
                [REGIME TRANSITION: {state.currentRegime.transition.phase}]
              </span>
              <span className="text-slate-200">
                {state.currentRegime.transition.restrictionReason} • Position Sizing throttled to {Math.round(state.currentRegime.transition.positionSizeMultiplier * 100)}%
              </span>
            </div>
          </div>
          <button
            onClick={() => setActiveTab('REGIME_TRANSITION')}
            className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-[11px] font-bold rounded transition-colors cursor-pointer"
          >
            Inspect Safeguards
          </button>
        </div>
      )}

      {/* Inventory Asymmetry & Liquidation Warning Banner */}
      {state.activeGrid?.inventoryAwareness && (
        state.activeGrid.inventoryAwareness.liquidationRiskTier === 'CRITICAL' ||
        Math.abs(state.activeGrid.inventoryAwareness.inventorySkew) >= 0.40
      ) && (
        <div className={`px-4 py-2 text-xs font-mono flex items-center justify-between border-b ${
          state.activeGrid.inventoryAwareness.liquidationRiskTier === 'CRITICAL'
            ? 'bg-rose-950/80 border-rose-500/50 text-rose-200'
            : 'bg-amber-950/80 border-amber-500/50 text-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 shrink-0" />
            <span>
              <strong>INVENTORY ASYMMETRY ACTIVE:</strong> {state.activeGrid.inventoryAwareness.inventoryPosturing.replace('_', ' ')} (Skew: {state.activeGrid.inventoryAwareness.inventorySkew >= 0 ? `+${state.activeGrid.inventoryAwareness.inventorySkew}` : state.activeGrid.inventoryAwareness.inventorySkew}) — BUY allocation slashed to {Math.round(state.activeGrid.inventoryAwareness.asymmetricBudgeting.buyAllocationPct * 100)}%, required BUY edge hurdle raised to {state.activeGrid.inventoryAwareness.asymmetricEdgeHurdles.requiredBuyEdgeHurdleBps} bps.
            </span>
          </div>
          <button
            onClick={() => setActiveTab('INVENTORY_AWARE_GRID')}
            className="px-2.5 py-1 bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/50 text-[11px] font-bold rounded transition-colors cursor-pointer shrink-0 ml-2"
          >
            Inspect Asymmetric Grid
          </button>
        </div>
      )}

      {/* 2. Real-Time Net Capital Accounting & Performance Metrics Bar */}
      <CapitalMetricsBar
        capital={state.capital}
        onOpenSweepModal={() => setActiveTab('PROFIT_SWEEP')}
      />

      {/* 3. Terminal View Tabs Bar */}
      <div className="border-b border-slate-800 bg-[#090D18] px-4 py-1.5">
        <div className="max-w-[1700px] mx-auto flex items-center justify-between gap-2 overflow-x-auto">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('TERMINAL')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'TERMINAL'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Grid Terminal</span>
            </button>

            <button
              onClick={() => setActiveTab('GIGPILOT_FUTURES')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                activeTab === 'GIGPILOT_FUTURES'
                  ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/80 shadow-lg shadow-emerald-950/50'
                  : 'text-emerald-400 hover:text-white hover:bg-emerald-950/40 border border-emerald-500/30'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span>Bybit USDT-Perp</span>
              <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                AUTONOMOUS
              </span>
            </button>

            <button
              onClick={() => setActiveTab('DECISION_PIPELINE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                activeTab === 'DECISION_PIPELINE'
                  ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-500/80 shadow-lg shadow-indigo-950/50'
                  : 'text-indigo-300 hover:text-white hover:bg-indigo-950/40 border border-indigo-500/30'
              }`}
            >
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              <span>3-Way Decisions</span>
              <span className="px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">
                BUY / SELL / DO NOTHING
              </span>
            </button>

            <button
              onClick={() => setActiveTab('AUTONOMOUS_OPTIMIZER')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                activeTab === 'AUTONOMOUS_OPTIMIZER'
                  ? 'bg-purple-950/90 text-purple-200 border border-purple-500/80 shadow-lg shadow-purple-950/50'
                  : 'text-purple-300 hover:text-white hover:bg-purple-950/40 border border-purple-500/30'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400 animate-pulse" />
              <span>Revenue AI Engine</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping ml-0.5" />
            </button>

            <button
              onClick={() => setActiveTab('REGIME_TRANSITION')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                activeTab === 'REGIME_TRANSITION'
                  ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-500/80 shadow-lg shadow-indigo-950/50'
                  : (state.currentRegime.transition?.isTransitioning
                      ? 'text-amber-300 hover:text-white bg-amber-950/50 border border-amber-500/50 animate-pulse'
                      : 'text-indigo-300 hover:text-white hover:bg-indigo-950/40 border border-indigo-500/30')
              }`}
            >
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              <span>Regime Transition</span>
              {state.currentRegime.transition?.isTransitioning && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping ml-0.5" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('INVENTORY_AWARE_GRID')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all relative ${
                activeTab === 'INVENTORY_AWARE_GRID'
                  ? 'bg-indigo-950/90 text-indigo-200 border border-indigo-500/80 shadow-lg shadow-indigo-950/50'
                  : (state.activeGrid?.inventoryAwareness && Math.abs(state.activeGrid.inventoryAwareness.inventorySkew) >= 0.35
                      ? 'text-amber-300 hover:text-white bg-amber-950/40 border border-amber-500/40'
                      : 'text-indigo-300 hover:text-white hover:bg-indigo-950/40 border border-indigo-500/30')
              }`}
            >
              <Scale className="w-3.5 h-3.5 text-indigo-400" />
              <span>Inventory Grid</span>
              {state.activeGrid?.inventoryAwareness && Math.abs(state.activeGrid.inventoryAwareness.inventorySkew) >= 0.35 && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse ml-0.5" />
              )}
            </button>

            <button
              onClick={() => setActiveTab('RECONCILIATION')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'RECONCILIATION'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-600/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Scale className="w-3.5 h-3.5 text-emerald-400" />
              <span>Reconciliation</span>
            </button>

            <button
              onClick={() => setActiveTab('ENGINES')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'ENGINES'
                  ? 'bg-sky-950/80 text-sky-300 border border-sky-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <span>Engines & Health</span>
            </button>

            <button
              onClick={() => setActiveTab('ASSETS')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'ASSETS'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-600/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>Bybit Assets</span>
            </button>

            <button
              onClick={() => setActiveTab('ADAPTIVE_GRID')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'ADAPTIVE_GRID'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Adaptive Grid</span>
            </button>

            <button
              onClick={() => setActiveTab('LEARNING_LOOP')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'LEARNING_LOOP'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              <span>Learning Loop</span>
            </button>

            <button
              onClick={() => setActiveTab('ML_RESEARCH')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'ML_RESEARCH'
                  ? 'bg-cyan-950/80 text-cyan-300 border border-cyan-600/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FlaskConical className="w-3.5 h-3.5 text-cyan-400" />
              <span>ML Research Log</span>
            </button>

            <button
              onClick={() => setActiveTab('SCRIPTING_IDE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'SCRIPTING_IDE'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code className="w-3.5 h-3.5" />
              <span>Strategy IDE</span>
            </button>

            <button
              onClick={() => setActiveTab('PROFIT_SWEEP')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'PROFIT_SWEEP'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Profit Sweep</span>
            </button>

            <button
              onClick={() => setActiveTab('WEB_RESEARCH')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'WEB_RESEARCH'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Web Research</span>
            </button>

            <button
              onClick={() => setActiveTab('RISK_SAFETY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'RISK_SAFETY'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>Risk & Veto</span>
            </button>

            <button
              onClick={() => setActiveTab('SYSTEM_CANARY')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'SYSTEM_CANARY'
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitPullRequest className="w-3.5 h-3.5" />
              <span>Canary & Audit</span>
            </button>

            <button
              onClick={() => setActiveTab('CREDENTIAL_VAULT')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
                activeTab === 'CREDENTIAL_VAULT'
                  ? 'bg-amber-950/80 text-amber-300 border border-amber-700/80 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Credential Vault</span>
            </button>
          </div>

          <button
            onClick={() => {
              setRefreshing(true);
              loadFullState();
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Sync</span>
          </button>
        </div>
      </div>

      {/* 4. Active Tab Content Body */}
      <main className="flex-1 p-4 max-w-[1700px] w-full mx-auto">
        {activeTab === 'TERMINAL' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[calc(100vh-190px)] min-h-[700px]">
            {/* Left: Interactive Candlestick + Grid Overlay Chart */}
            <div className="lg:col-span-7 h-full">
              <InteractiveGridChart
                symbol={state.activeSymbol}
                candles={pairDetails?.candles || []}
                orderBook={pairDetails?.orderBook || { bids: [], asks: [] }}
                grid={state.activeGrid}
                indicators={state.indicators}
                currentPrice={activePrice}
                depthImbalanceRatio={pairDetails?.depthImbalanceRatio}
                fundingRateBps={pairDetails?.fundingRateBps}
                fundingCountdownSeconds={pairDetails?.fundingCountdownSeconds}
              />
            </div>

            {/* Right: Grid Matrix, Orders, Execution Fills, and Manual Ticket */}
            <div className="lg:col-span-5 h-full">
              <GridMatrixAndOrders
                grid={state.activeGrid}
                currentPrice={activePrice}
                openOrders={state.openOrders}
                recentFills={state.recentFills}
                position={state.position}
                onCancelOrder={async (id) => {
                  await cancelOrder(id);
                  loadFullState();
                }}
                onCancelAllOrders={async () => {
                  await cancelAllOrders();
                  loadFullState();
                }}
                onPlaceManualOrder={async (order) => {
                  const res = await placeManualOrder(order);
                  loadFullState();
                  return res;
                }}
              />
            </div>
          </div>
        )}

        {activeTab === 'GIGPILOT_FUTURES' && (
          <GigPilotFuturesView />
        )}

        {activeTab === 'RECONCILIATION' && (
          <ReconciliationTerminal />
        )}

        {activeTab === 'AUTONOMOUS_OPTIMIZER' && (
          <AutonomousRevenueEngineView
            capital={state.capital}
            grid={state.activeGrid}
            regime={state.currentRegime}
            champion={state.championStrategy}
            latestAudit={state.autonomousOptimizer?.latestAudit || null}
            latestStrategyAllocation={state.autonomousOptimizer?.latestStrategyAllocation || null}
            decisions={state.autonomousOptimizer?.decisions || []}
            builds={state.autonomousOptimizer?.builds || []}
            autoApplyEnabled={state.autonomousOptimizer?.autoApplyEnabled ?? true}
            onTriggerAuditAndBuild={handleTriggerAuditAndBuild}
            onToggleAutoApply={handleToggleAutoApply}
            onReallocateCapital={handleReallocateCapital}
          />
        )}

        {activeTab === 'REGIME_TRANSITION' && (
          <RegimeTransitionView
            regime={state.currentRegime}
            currentPrice={activePrice}
            symbol={state.activeSymbol}
            onRefresh={loadFullState}
          />
        )}

        {activeTab === 'INVENTORY_AWARE_GRID' && (
          <InventoryAwareGridView
            activeSymbol={state.activeSymbol}
            currentPrice={activePrice}
            marketRegime={state.currentRegime}
            activeGrid={state.activeGrid}
            onRefresh={loadFullState}
          />
        )}

        {activeTab === 'ENGINES' && (
          <>
            {/* Authoritative "can we trade right now?" verdict, above everything else so a blocked
                platform can never be mistaken for a working one. */}
            <TradingReadinessBanner />
            <EngineHealthView onEngineToggled={loadFullState} />
          </>
        )}

        {activeTab === 'ASSETS' && (
          <AssetDashboard
            onNavigateToTrade={() => setActiveTab('TERMINAL')}
            isOwnerAuthenticated={isOwnerAuth}
            onOpenOwnerLogin={() => setShowAuthModal(true)}
          />
        )}

        {activeTab === 'ADAPTIVE_GRID' && (
          <AdaptiveGridConfigurator
            currentPrice={pairDetails?.currentPrice || 0}
            activeGrid={state.activeGrid}
            regime={state.currentRegime}
            onApplyConfig={async (cfg) => {
              await configureGrid(cfg);
              loadFullState();
            }}
          />
        )}

        {activeTab === 'DECISION_PIPELINE' && (
          <div className="max-w-5xl mx-auto">
            <DecisionPipelineVisualizer
              decisionStats={state.decisionStats}
              currentSymbol={state.activeSymbol}
              onRefresh={loadFullState}
            />
          </div>
        )}

        {activeTab === 'LEARNING_LOOP' && strategies && (
          <LearningLoopView
            champion={strategies.champion}
            challengers={strategies.challengers}
            history={strategies.history}
            decisionStats={state.decisionStats}
            rollbackTelemetry={strategies.rollbackTelemetry}
            activeSymbol={state.activeSymbol}
            onRefresh={loadFullState}
            onPromoteChallenger={async (id) => {
              const res = await promoteChallenger(id);
              loadFullState();
              return res;
            }}
            onRollbackChampion={async (reason) => {
              const res = await rollbackStrategy(reason);
              loadFullState();
              return { success: res.success, reason: res.message || res.error || 'Rollback complete' };
            }}
            onCreateVariant={async (params) => {
              await createStrategyVariant(params);
              loadFullState();
            }}
          />
        )}

        {activeTab === 'ML_RESEARCH' && (
          <MLResearchAuditLog
            activeSymbol={state.activeSymbol}
            onRefresh={loadFullState}
          />
        )}

        {activeTab === 'SCRIPTING_IDE' && (
          <ScriptingIdeView />
        )}
        {activeTab === 'PROFIT_SWEEP' && profitSweepInfo && (
          <ProfitSweepView
            capital={state.capital}
            destinationWallet={profitSweepInfo.destinationWallet || state.destinationWallet}
            sweepEligibility={profitSweepInfo.eligibility || state.sweepEligibility}
            sweepsHistory={profitSweepInfo.history || []}
            onRefreshState={loadFullState}
          />
        )}

        {activeTab === 'WEB_RESEARCH' && (
          <WebResearchView
            items={researchItems}
            onRefreshItems={loadFullState}
          />
        )}

        {activeTab === 'RISK_SAFETY' && riskData && (
          <RiskAndSafetyView
            config={riskData.config}
            circuitBreakerActive={riskData.circuitBreakerActive}
            events={riskData.events || []}
            onRefreshState={loadFullState}
          />
        )}

        {activeTab === 'CREDENTIAL_VAULT' && (
          <CredentialVaultView
            isOwnerAuth={isOwnerAuth}
            onRequireAuth={() => setShowAuthModal(true)}
          />
        )}

        {activeTab === 'SYSTEM_CANARY' && (
          <CanaryAndAuditView
            updates={updatesHistory}
            auditLogs={auditLogs}
            onRefreshState={loadFullState}
          />
        )}
      </main>

      {/* 5. Single Owner Authentication & TOTP Modal */}
      <OwnerAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={() => {
          setIsOwnerAuth(true);
          loadFullState();
        }}
      />
    </div>
  );
};
